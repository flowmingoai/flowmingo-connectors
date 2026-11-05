// Structural checks of the generated Make app. Make has no local IML runtime, so these prove that the files are complete
// and that every reference resolves (code files, RPCs, parameters, API routes); behaviour is proven by test scenarios
// in Make itself (see ../README.md). The rules of Make's app review are checked here too, so a regression fails locally.
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
const rpcs = Object.entries(app.components.rpc).map(([id, meta]) => ({ id, meta, communication: read(meta.codeFiles.communication) }))
const groups = read(app.generalCodeFiles.groups)
const byId = (id) => modules.find((module) => module.id === id)

/** Every parameter, nested selects and array items included. */
const allParams = (params) =>
  params.flatMap((param) => {
    const nested = param.options && typeof param.options === 'object' && !Array.isArray(param.options) ? param.options.nested ?? [] : []
    const items = param.type === 'array' && Array.isArray(param.spec) ? param.spec : []
    return [param, ...allParams(Array.isArray(nested) ? nested : []), ...allParams(items)]
  })
const paramNames = (params) => allParams(params).map((param) => param.name)

const referencedParams = (value) => [...JSON.stringify(value).matchAll(/parameters\.([A-Za-z0-9_]+)/g)].map((match) => match[1])

const rpcReferences = (value) => [...JSON.stringify(value).matchAll(/rpc:\/\/([A-Za-z0-9_]+)/g)].map((match) => match[1])

const routePattern = (path) => new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`)
const knownRoutes = contract.operations.map((operation) => routePattern(operation.path))
const isKnownRoute = (url) => knownRoutes.some((route) => route.test(url.replace(/\{\{[^}]+\}\}/g, 'x')))

// Sentence case: only the first word starts with a capital, except acronyms and names.
const CAPITALISED_WORDS = new Set(['AI', 'API', 'ID', 'IDs', 'URL', 'CV', 'Flowmingo', 'Make'])
const isSentenceCase = (label) =>
  label
    .split(/\s+/)
    .slice(1)
    .every((word) => !/^[A-Z]/.test(word) || CAPITALISED_WORDS.has(word.replace(/[^A-Za-z]/g, '')))

const ISO = "'YYYY-MM-DDTHH:mm:ss.SSSZ'"
const parsesDate = (expression, path) => expression === `{{if(${path}, parseDate(${path}, ${ISO}), undefined)}}`

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
    const grouped = groups.flatMap((group) => group.modules)
    assert.deepEqual([...grouped].sort(), modules.map((module) => module.id).sort())
  })

  it('should order each group as list and search, then get, then create, then update', () => {
    const rank = (id) => {
      const meta = byId(id).meta
      return { search: 0, read: 1, create: 2, update: 3, delete: 4 }[meta.actionCrud ?? meta.moduleType] ?? 0
    }
    for (const group of groups) {
      const ranks = group.modules.map(rank)
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), group.label)
    }
    assert.deepEqual(groups.find((group) => group.label === 'Candidates').modules, ['searchCandidates', 'getCandidate', 'inviteCandidate'])
    assert.deepEqual(groups.find((group) => group.label === 'Hiring projects').modules, ['listProjects', 'createProject'])
    assert.equal(groups.find((group) => group.label === 'Results').modules[0], 'getResult')
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

  it('should test the key on /me/v1 with a masked parameter that keeps its name', () => {
    const meta = app.components.connection.flowmingo
    const communication = read(meta.codeFiles.communication)
    const params = read(meta.codeFiles.params)
    assert.equal(communication.url, `${contract.base_url}/me/v1`)
    assert.deepEqual(communication.log.sanitize, ['request.headers.x-api-key'])
    const key = params.find((param) => param.name === 'apiKey')
    assert.equal(key.type, 'password')
    assert.equal(key.label, 'API key')
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

  it('should give every action module its module action', () => {
    for (const module of modules.filter((module) => module.meta.moduleType === 'action')) {
      assert.ok(['create', 'read', 'update', 'delete'].includes(module.meta.actionCrud), module.id)
    }
  })

  it('should write module, parameter, group and RPC labels in sentence case', () => {
    const labels = [
      ...modules.map((module) => [module.id, module.meta.label]),
      ...modules.flatMap((module) =>
        allParams([...module.staticParams, ...module.mappableParams]).map((param) => [`${module.id}.${param.name}`, param.label])
      ),
      ...groups.map((group) => ['group', group.label]),
      ...rpcs.map((rpc) => [rpc.id, rpc.meta.label])
    ]
    for (const [where, label] of labels) assert.ok(isSentenceCase(label), `${where}: "${label}" is not in sentence case`)
  })

  it('should name every parameter after the API field it fills (snake case)', () => {
    for (const module of modules.filter((module) => module.meta.moduleType !== 'universal')) {
      for (const name of paramNames([...module.staticParams, ...module.mappableParams])) {
        assert.match(name, /^[a-z][a-z0-9_]*$/, `${module.id}.${name}`)
      }
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

  it('should build every request body from the parameters in bulk, never field by field', () => {
    for (const module of modules.filter((module) => module.communication.body !== undefined && module.meta.moduleType !== 'universal')) {
      const { body } = module.communication
      const fromParameters = (value) => value === '{{parameters}}' || /^\{\{omit\(parameters, /.test(value)
      if (typeof body === 'string') assert.ok(fromParameters(body), `${module.id} body ${body}`)
      else assert.ok(fromParameters(body['{{...}}']), `${module.id} body does not spread the parameters`)
    }
    assert.deepEqual(byId('inviteCandidate').communication.body.candidates, [
      "{{pick(parameters, 'email', 'firstname', 'lastname', 'cv_link')}}"
    ])
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

  it('should describe every output field in the interface', () => {
    for (const module of modules) {
      const output = module.communication.response?.output
      if (!output || typeof output !== 'object') continue
      const described = new Set(module.interface.map((field) => field.name))
      for (const key of Object.keys(output).filter((key) => key !== '{{...}}')) {
        assert.ok(described.has(key), `${module.id} outputs ${key} without an interface entry`)
      }
    }
  })

  it('should output every date of the interface as a date, parsed with parseDate', () => {
    for (const module of modules.filter((module) => module.meta.moduleType !== 'universal')) {
      const dates = module.interface.filter((field) => field.type === 'date').map((field) => field.name)
      if (dates.length === 0) continue
      const { output } = module.communication.response
      assert.equal(typeof output, 'object', `${module.id} returns its dates as text`)
      const isTrigger = module.meta.moduleType === 'trigger'
      const source = isTrigger ? null : output['{{...}}'].slice(2, -2)
      for (const key of dates) {
        const path = isTrigger ? (key === 'timestamp' ? 'item.timestamp' : `item.data.${key}`) : `${source}.${key}`
        assert.ok(parsesDate(output[key], path), `${module.id}.${key}: ${output[key]}`)
      }
    }
  })

  it('should give the universal module a path under the API address only', () => {
    const universal = modules.find((module) => module.meta.moduleType === 'universal')
    assert.equal(universal.meta.label, 'Make an API call')
    assert.equal(universal.meta.description, 'Performs an arbitrary authorized API call.')
    assert.equal(universal.communication.url, `${contract.base_url}{{parameters.url}}`)
  })

  it('should give every search an optional limit of 10 and pagination at the largest page the API serves', () => {
    for (const module of modules.filter((module) => module.meta.moduleType === 'search')) {
      const limit = module.mappableParams.find((param) => param.name === 'limit')
      assert.ok(limit && !limit.required && limit.default === 10 && !limit.advanced, module.id)
      assert.equal(module.communication.response.limit, '{{parameters.limit}}', module.id)
      assert.equal(module.communication.qs.limit, 100, module.id)
      assert.equal(module.communication.pagination.condition, '{{length(body.data) = 100}}', module.id)
    }
  })

  it('should never send the hiring project picker of Move to Stage, and not require it', () => {
    const move = byId('moveApplication')
    assert.equal(move.communication.body, "{{omit(parameters, 'application_id', 'com_project_id')}}")
    assert.ok(!move.mappableParams.find((param) => param.name === 'com_project_id').required)
    assert.ok(move.mappableParams.find((param) => param.name === 'com_stage_id').required)
  })

  it('should return the whole invite result, with the read-out fields after it', () => {
    const output = byId('inviteCandidate').communication.response.output
    assert.equal(Object.keys(output)[0], '{{...}}')
    assert.equal(output['{{...}}'], '{{body.results[1]}}')
  })

  it('should create a project without assessments so the call stays under the module timeout', () => {
    assert.deepEqual(byId('createProject').communication.body.assessments, [])
  })
})

describe('triggers', () => {
  const triggers = modules.filter((module) => module.meta.moduleType === 'trigger')

  it('should watch every event type of the contract once', () => {
    const watched = triggers.map((trigger) => trigger.communication.qs.event_type).sort()
    assert.deepEqual(watched, contract.events.map((event) => event.event_type).sort())
  })

  it('should poll the feed newest first at its largest page, deduped by event id and parsed date, with a required limit', () => {
    for (const trigger of triggers) {
      const { response, pagination, url, qs } = trigger.communication
      assert.equal(url, contract.events_feed.path, trigger.id)
      assert.equal(qs.limit, contract.events_feed.max_limit, trigger.id)
      assert.deepEqual(response.trigger, {
        id: '{{item.event_id}}',
        date: `{{parseDate(item.timestamp, ${ISO})}}`,
        type: 'date',
        order: 'desc'
      })
      assert.equal(response.limit, '{{parameters.limit}}')
      assert.deepEqual(pagination, { qs: { cursor: '{{body.next_cursor}}' }, condition: '{{body.next_cursor}}' })
      const limit = trigger.staticParams.find((param) => param.name === 'limit')
      assert.ok(limit && limit.required && limit.type === 'uinteger', trigger.id)
      assert.match(trigger.meta.label, /^Watch /)
    }
  })

  it('should offer the sub-event filter of each event that has one, named after its field', () => {
    for (const event of contract.events.filter((event) => event.sub_event_field)) {
      const trigger = triggers.find((candidate) => candidate.communication.qs.event_type === event.event_type)
      const filter = trigger.staticParams.find((param) => param.type === 'select')
      assert.equal(filter.name, event.sub_event_field, trigger.id)
      assert.notEqual(filter.label, 'Only when', trigger.id)
      assert.deepEqual(filter.options.map((option) => option.value), Object.keys(event.sub_event_choices), trigger.id)
      assert.match(trigger.communication.response.iterate.condition, new RegExp(`item\\.data\\.${event.sub_event_field} = parameters\\.${filter.name}`))
    }
  })

  it('should return the whole event: its data at the top level, then the envelope, then every date parsed', () => {
    for (const event of contract.events) {
      const trigger = triggers.find((candidate) => candidate.communication.qs.event_type === event.event_type)
      const { output } = trigger.communication.response
      assert.equal(Object.keys(output)[0], '{{...}}', trigger.id)
      assert.equal(output['{{...}}'], '{{item.data}}', trigger.id)
      for (const key of ['event_id', 'event_type', 'sub_event']) assert.equal(output[key], `{{item.${key}}}`, `${trigger.id}.${key}`)
      assert.ok(parsesDate(output.timestamp, 'item.timestamp'), `${trigger.id}.timestamp`)
      for (const key of Object.keys(event.sample).filter((key) => key.endsWith('_at'))) {
        assert.ok(parsesDate(output[key], `item.data.${key}`), `${trigger.id}.${key}`)
      }
      for (const key of Object.keys(event.sample)) {
        assert.ok(trigger.interface.some((field) => field.name === key), `${trigger.id} does not describe ${key}`)
      }
    }
  })
})

describe('RPCs', () => {
  it('should output label and value, carry a limit and only call routes of the contract', () => {
    for (const rpc of rpcs) {
      assert.ok(isKnownRoute(rpc.communication.url), `${rpc.id} calls ${rpc.communication.url}`)
      assert.ok(rpc.communication.response.output.label && rpc.communication.response.output.value === '{{item.id}}', rpc.id)
      assert.ok(rpc.communication.response.limit > 0, rpc.id)
    }
  })

  it('should read only the hiring project id from the module that uses them', () => {
    for (const rpc of rpcs) {
      for (const name of referencedParams(rpc.communication)) assert.equal(name, 'com_project_id', rpc.id)
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

  it('should tell same-titled job posts apart by their creation date', () => {
    assert.match(rpcs.find((rpc) => rpc.id === 'listJobPosts').communication.response.output.label, /formatDate\(parseDate\(item\.created_at/)
  })
})
