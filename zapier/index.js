'use strict'

const zapier = require('zapier-platform-core')

const authentication = require('./authentication')
const { addApiKey, handleErrors } = require('./lib/http')
const hydrators = require('./lib/hydrators')
const eventTriggers = require('./triggers/events')
const listTriggers = require('./triggers/lists')
const invite = require('./creates/invite')
const pipeline = require('./creates/pipeline')
const review = require('./creates/review')
const project = require('./creates/project')
const findCandidate = require('./searches/candidate')
const findResult = require('./searches/result')

const byKey = (list) => Object.fromEntries(list.map((item) => [item.key, item]))

module.exports = {
  version: require('./package.json').version,
  platformVersion: zapier.version,
  authentication,
  beforeRequest: [addApiKey],
  afterResponse: [handleErrors],
  hydrators,
  triggers: byKey([...eventTriggers, ...listTriggers]),
  creates: byKey([invite, ...pipeline, ...review, project]),
  searches: byKey([findCandidate, findResult]),
  searchOrCreates: {}
}
