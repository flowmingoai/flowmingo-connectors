// Structural checks of the generated Make app. Make has no local IML runtime, so these prove that the files are complete
// and that every reference resolves (code files, RPCs, parameters, API routes); behaviour is proven by test scenarios
// in Make itself (see ../README.md).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const contract = JSON.parse(readFileSync(join(ROOT, '..', 'shared', 'contract.json'), 'utf8'))
const app = JSON.parse(readFileSync(join(SRC, 'makecomapp.json'), 'utf8'))
const read = (path) => JSON.parse(readFileSync(join(SRC, path), 'utf8'))

const modules = Object.entries(app.components.module).map(([id, meta]) => ({
  id,
  meta,
  communication: read(meta.codeFiles.communication),
  staticParams: read(meta.codeFiles.staticParams),
  mappableParams: read(meta.codeFiles.mappableParams),
  interface: read(meta.codeFiles.interface),
  samples: read(meta.codeFiles.samples)
}))
const rpcs = Object.entries(app.components.rpc).map(([id, meta]) => ({ id, communication: read(meta.codeFiles.communication) }))

/** Every parameter name, nested selects included. */
const paramNames = (params) =>
  params.flatMap((param) => {
    const nested = param.options && typeof param.options === 'object' && !Array.isArray(param.options) ? param.options.nested ?? [] : []
    return [param.name, ...paramNames(Array.isArray(nested) ? nested : [])]
  })

const referencedParams = (value) => [...JSON.stringify(value).matchAll(/parameters\.([A-Za-z0-9_]+)/g)].map((match) => match[1])

const rpcReferences = (value) => [...JSON.stringify(value).matchAll(/rpc:\/\/([A-Za-z0-9_]+)/g)].map((match) => match[1])

const routePattern = (path) => new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`)
const knownRoutes = contract.operations.map((operation) => routePattern(operation.path))
const isKnownRoute = (url) => knownRoutes.some((route) => route.test(url.replace(/\{\{[^}]+\}\}/g, 'x')))

describe('makecomapp.json', () => {
  it('should point at code files that all exist and parse', () => {
    const paths = [
      ...Object.values(app.generalCodeFiles),
      ...Object.values(app.components)
        .flatMap((components) => Object.values(components))
        .flatMap((component) => Object.values(component.codeFiles))
    ].filter((path) => path !== null)
    for (const path of paths) {
      assert.ok(existsSync(join(SRC, path)), `missing ${path}`)
      if (path.endsWith('.jsonc') || path.endsWith('.json')) assert.doesNotThrow(() => read(path), path)
    }
  })

  it('should list every component type the Make extension expects', () => {
    assert.deepEqual(Object.keys(app.components).sort(), ['connection', 'endpoint', 'function', 'module', 'rpc', 'webhook'])
  })

  it('should put every module in exactly one group', () => {
    const grouped = read(app.generalCodeFiles.groups).flatMap((group) => group.modules)
    assert.deepEqual([...grouped].sort(), modules.map((module) => module.id).sort())
  })
})

describe('base and connection', () => {
  it('should send the key in x-api-key and keep it out of the logs', () => {
    const base = read(app.generalCodeFiles.base)
    assert.equal(base.baseUrl, contract.base_url)
    assert.equal(base.headers['x-api-key'], '{{connection.apiKey}}')
    assert.deepEqual(base.log.sanitize, ['request.headers.x-api-key'])
    assert.equal(base.response.error['401'].type, 'InvalidAccessTokenError')
    assert.match(base.response.error.message, /\{\{statusCode\}\}/)
  })

  it('should test the key on /me/v1 with a masked parameter', () => {
    const meta = app.components.connection.flowmingo
    const communication = read(meta.codeFiles.communication)
    const params = read(meta.codeFiles.params)
    assert.equal(communication.url, `${contract.base_url}/me/v1`)
    assert.deepEqual(communication.log.sanitize, ['request.headers.x-api-key'])
    assert.equal(params.find((param) => param.name === 'apiKey').type, 'password')
  })
})

describe('modules', () => {
  it('should each have a label, a description, a known type and the Flowmingo connection', () => {
    for (const module of modules) {
      assert.ok(module.meta.label && module.meta.description, module.id)
      assert.ok(['trigger', 'action', 'search', 'universal'].includes(module.meta.moduleType), module.id)
      assert.equal(module.meta.connection, 'flowmingo', module.id)
    }
  })

  it('should only read parameters they declare', () => {
    for (const module of modules) {
      const declared = new Set(paramNames([...module.staticParams, ...module.mappableParams]))
      for (const name of referencedParams(module.communication)) {
        assert.ok(declared.has(name), `${module.id} reads parameters.${name} but does not declare it`)
      }
    }
  })

  it('should only call routes of the public API contract', () => {
    for (const module of modules.filter((module) => module.meta.moduleType !== 'universal')) {
      assert.ok(isKnownRoute(module.communication.url), `${module.id} calls ${module.communication.url}`)
    }
  })

  it('should only reference RPCs that exist', () => {
    const names = new Set(rpcs.map((rpc) => rpc.id))
    for (const module of modules) {
      for (const name of rpcReferences(module.mappableParams)) assert.ok(names.has(name), `${module.id} uses rpc://${name}`)
    }
  })

  it('should describe every output field in the interface and the sample', () => {
    for (const module of modules) {
      const output = module.communication.response?.output
      if (!output || typeof output !== 'object') continue
      const described = new Set(module.interface.map((field) => field.name))
      for (const key of Object.keys(output)) assert.ok(described.has(key), `${module.id} outputs ${key} without an interface entry`)
    }
  })

  it('should include the universal Make an API Call module', () => {
    const universal = modules.find((module) => module.meta.moduleType === 'universal')
    assert.equal(universal.meta.label, 'Make an API Call')
    assert.equal(universal.meta.description, 'Performs an arbitrary authorized API call.')
  })

  it('should give every search a limit and pagination', () => {
    for (const module of modules.filter((module) => module.meta.moduleType === 'search')) {
      assert.ok(paramNames(module.mappableParams).includes('limit'), module.id)
      assert.equal(module.communication.response.limit, '{{parameters.limit}}', module.id)
      assert.ok(module.communication.pagination, module.id)
    }
  })

  it('should never send the hiring project picker of Move to Stage, only the stage', () => {
    const move = modules.find((module) => module.id === 'moveApplication')
    assert.deepEqual(move.communication.body, { com_stage_id: '{{parameters.stageId}}' })
  })

  it('should create a project without assessments so the call stays under the module timeout', () => {
    const create = modules.find((module) => module.id === 'createProject')
    assert.deepEqual(create.communication.body.assessments, [])
  })
})

describe('triggers', () => {
  const triggers = modules.filter((module) => module.meta.moduleType === 'trigger')

  it('should watch every event type of the contract once', () => {
    const watched = triggers.map((trigger) => trigger.communication.qs.event_type).sort()
    assert.deepEqual(watched, contract.events.map((event) => event.event_type).sort())
  })

  it('should poll the feed newest first, deduped by event id and date, with a required limit', () => {
    for (const trigger of triggers) {
      const { response, pagination, url } = trigger.communication
      assert.equal(url, contract.events_feed.path, trigger.id)
      assert.deepEqual(response.trigger, { id: '{{item.event_id}}', date: '{{item.timestamp}}', type: 'date', order: 'desc' })
      assert.equal(response.limit, '{{parameters.limit}}')
      assert.deepEqual(pagination, { qs: { cursor: '{{body.next_cursor}}' }, condition: '{{body.next_cursor}}' })
      const limit = trigger.staticParams.find((param) => param.name === 'limit')
      assert.ok(limit && limit.required && limit.type === 'uinteger', trigger.id)
      assert.match(trigger.meta.label, /^Watch /)
    }
  })

  it('should offer the sub-event filter of each event that has one', () => {
    for (const event of contract.events.filter((event) => event.sub_event_field)) {
      const trigger = triggers.find((candidate) => candidate.communication.qs.event_type === event.event_type)
      const filter = trigger.staticParams.find((param) => param.type === 'select')
      assert.deepEqual(filter.options.map((option) => option.value), Object.keys(event.sub_event_choices), trigger.id)
      assert.match(trigger.communication.response.iterate.condition, new RegExp(`item\\.data\\.${event.sub_event_field} = parameters\\.${filter.name}`))
    }
  })

  it('should output every field of the contract sample', () => {
    for (const event of contract.events) {
      const trigger = triggers.find((candidate) => candidate.communication.qs.event_type === event.event_type)
      for (const key of Object.keys(event.sample)) {
        assert.equal(trigger.communication.response.output[key], `{{item.data.${key}}}`, `${trigger.id}.${key}`)
      }
    }
  })
})

describe('RPCs', () => {
  it('should output label and value and only call routes of the contract', () => {
    for (const rpc of rpcs) {
      assert.ok(isKnownRoute(rpc.communication.url), `${rpc.id} calls ${rpc.communication.url}`)
      assert.ok(rpc.communication.response.output.label && rpc.communication.response.output.value === '{{item.id}}', rpc.id)
    }
  })

  it('should read only the project id from the module that nests them', () => {
    for (const rpc of rpcs) {
      for (const name of referencedParams(rpc.communication)) assert.equal(name, 'projectId', rpc.id)
    }
  })

  it('should keep only assessments the invite route can send', () => {
    const condition = rpcs.find((rpc) => rpc.id === 'listAssessments').communication.response.iterate.condition
    for (const type of Object.keys(contract.invitable_set_types)) assert.match(condition, new RegExp(`item\\.set_type = ${type},`))
    assert.doesNotMatch(condition, /item\.set_type = 4,/)
  })

  it("should label each assessment with its kind and, when it is not active, its state (a draft's invitation is not emailed)", () => {
    const label = rpcs.find((rpc) => rpc.id === 'listAssessments').communication.response.output.label
    for (const [type, kind] of Object.entries(contract.invitable_set_types)) {
      assert.ok(label.includes(`item.set_type = ${type}, '${kind}'`), `the label does not name set type ${type} as ${kind}`)
    }
    for (const [status, state] of Object.entries(contract.inactive_set_statuses)) {
      assert.ok(label.includes(`item.status = ${status}, '${state}'`), `the label does not name status ${status} as ${state}`)
    }
  })
})
