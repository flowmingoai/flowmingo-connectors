'use strict'

const { url } = require('./lib/http')

const test = async (z) => {
  const response = await z.request({ url: url('/me/v1') })
  return response.data
}

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText:
        'Create a key in Flowmingo under **Settings > API keys** and paste it here (it starts with `fl_`). ' +
        'Give it the scopes your Zaps need: `read_hiring` for triggers and lists, `read_candidates` for names and emails, ' +
        '`invite_candidates` to invite, `write_pipeline` to move, reject and review, `create_project` to create projects. ' +
        'Triggers need a key created by an Owner or Admin. [How to create a key](https://flowmingo.ai/integration/api-integration).'
    }
  ],
  test,
  connectionLabel: 'Organization {{organization_id}}'
}
