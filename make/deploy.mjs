// Pushes ./src to an existing Make custom app through Make's SDK API: the same calls Make's VS Code extension makes.
// It updates every component in place (base, readme, groups, the connection, RPCs and modules) and creates the ones the
// app does not have yet. It never deletes anything.
//
//   node deploy.mjs <app-name> <app-version> [--connection <name in Make>] [--zone eu1] [--dry-run]
//
// The token is read from MAKE_TOKEN, or from the file in MAKE_TOKEN_FILE (default ~/.config/flowmingo-connectors/make-token).
// It needs Make's apps:read and apps:write scopes. Run `npm test` first: this script deploys whatever src/ holds.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SRC = join(ROOT, 'src')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const [appName, appVersion] = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
if (!appName || !appVersion) {
  console.error('Usage: node deploy.mjs <app-name> <app-version> [--connection <name>] [--zone eu1] [--dry-run]')
  process.exit(2)
}
const isDryRun = args.includes('--dry-run')
const zone = option('zone', 'eu1')
const token =
  process.env.MAKE_TOKEN ??
  readFileSync(process.env.MAKE_TOKEN_FILE ?? join(homedir(), '.config', 'flowmingo-connectors', 'make-token'), 'utf8').trim()

const API = `https://${zone}.make.com/api/v2/sdk/apps`
const APP = `${API}/${appName}/${appVersion}`
// Make's numeric module types (the SDK answers them on every module).
const MODULE_TYPE_IDS = { trigger: 1, action: 4, search: 9, universal: 12 }

const app = JSON.parse(readFileSync(join(SRC, 'makecomapp.json'), 'utf8'))
const source = (path) => readFileSync(join(SRC, path), 'utf8')

async function call(method, url, body, contentType = 'application/json') {
  if (isDryRun && method !== 'GET') {
    console.log(`[dry-run] ${method} ${url.replace(API, '')}`)
    return {}
  }
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Token ${token}`, ...(body === undefined ? {} : { 'Content-Type': contentType }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${url.replace(API, '')} answered ${response.status}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : {}
}
// A code section is sent as the file's own text: Make stores IML JSON as written.
const putCode = (url, path) => call('PUT', url, source(path), 'application/jsonc')

async function main() {
  const existingModules = new Map((await call('GET', `${APP}/modules`)).appModules.map((module) => [module.name, module]))
  const existingRpcs = new Set((await call('GET', `${APP}/rpcs`)).appRpcs.map((rpc) => rpc.name))
  // The app's connection in Make has its own name (the app name, for the first connection); the local id is "flowmingo".
  const remoteConnection = option('connection', [...existingModules.values()][0]?.connection ?? appName)

  await putCode(`${APP}/base`, app.generalCodeFiles.base)
  await call('PUT', `${APP}/readme`, source(app.generalCodeFiles.readme), 'text/markdown')
  await call('PUT', `${APP}/groups`, source(app.generalCodeFiles.groups))
  console.log('base, readme, groups')

  const [localConnection] = Object.values(app.components.connection)
  await putCode(`${API}/connections/${remoteConnection}/api`, localConnection.codeFiles.communication)
  await putCode(`${API}/connections/${remoteConnection}/parameters`, localConnection.codeFiles.params)
  console.log(`connection ${remoteConnection}`)

  for (const [name, rpc] of Object.entries(app.components.rpc)) {
    if (existingRpcs.has(name)) await call('PATCH', `${APP}/rpcs/${name}`, { label: rpc.label })
    else await call('POST', `${APP}/rpcs`, { name, label: rpc.label, connection: remoteConnection })
    await putCode(`${APP}/rpcs/${name}/api`, rpc.codeFiles.communication)
    await putCode(`${APP}/rpcs/${name}/parameters`, rpc.codeFiles.params)
    console.log(`rpc ${name}`)
  }

  for (const [name, module] of Object.entries(app.components.module)) {
    // The module action (crud) is what Make's review reads in the Edit Module dialog; triggers and searches are read-only.
    const crud = module.actionCrud ?? (module.moduleType === 'trigger' || module.moduleType === 'search' ? 'read' : null)
    const meta = { label: module.label, description: module.description, ...(crud ? { crud } : {}) }
    if (existingModules.has(name)) await call('PATCH', `${APP}/modules/${name}`, meta)
    else await call('POST', `${APP}/modules`, { name, typeId: MODULE_TYPE_IDS[module.moduleType], connection: remoteConnection, ...meta })
    const sections = {
      api: module.codeFiles.communication,
      parameters: module.codeFiles.staticParams,
      expect: module.codeFiles.mappableParams,
      interface: module.codeFiles.interface,
      samples: module.codeFiles.samples,
      scope: module.codeFiles.scope
    }
    for (const [section, path] of Object.entries(sections)) await putCode(`${APP}/modules/${name}/${section}`, path)
    console.log(`module ${name}${existingModules.has(name) ? '' : ' (created)'}`)
  }
  console.log(`${isDryRun ? 'Dry run of' : 'Deployed'} ${appName} v${appVersion}: ${Object.keys(app.components.module).length} modules, ${Object.keys(app.components.rpc).length} RPCs`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
