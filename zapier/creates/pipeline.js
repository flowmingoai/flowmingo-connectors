'use strict'

const { url } = require('../lib/http')
const { compact, projectField, stageField, jobPostField } = require('../lib/fields')

const applicationIdField = {
  key: 'application_id',
  label: 'Application ID',
  required: true,
  helpText: 'The application id, for example from the New Application trigger.'
}

const addApplication = {
  key: 'add_application',
  noun: 'Application',
  display: {
    label: 'Add Candidate to Hiring Project',
    description: 'Puts a candidate who is already in your Flowmingo account into a hiring project.'
  },
  operation: {
    inputFields: [
      {
        key: 'tal_candidate_id',
        label: 'Candidate ID',
        required: true,
        search: 'find_candidate.id',
        helpText: 'A candidate already in your account. To bring in someone new, use Invite Candidate.'
      },
      projectField({ required: true }),
      jobPostField({ helpText: 'Needed when the project has more than one job post.' }),
      stageField({ required: false, helpText: 'Leave empty to start in the first stage.' })
    ],
    perform: async (z, bundle) => {
      const input = bundle.inputData
      const response = await z.request({
        url: url('/hiring/applications/v1'),
        method: 'POST',
        body: compact({
          tal_candidate_id: input.tal_candidate_id,
          com_project_id: input.com_project_id,
          com_job_post_id: input.com_job_post_id,
          com_stage_id: input.com_stage_id
        })
      })
      return response.data
    },
    sample: {
      id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3',
      com_project_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      com_job_post_id: 'c0ffee00-dead-4bee-8f00-0123456789ab',
      com_stage_id: '5b8d1e92-3a7c-4c60-b2f4-91e6a0d7c358',
      status: 1
    }
  }
}

const moveStage = {
  key: 'move_application_stage',
  noun: 'Application',
  display: {
    label: 'Move Application to Stage',
    description:
      'Moves an application to another stage of its hiring project. Emails the candidate if your team switched that on for the stage.'
  },
  operation: {
    inputFields: [
      applicationIdField,
      projectField({ required: true, helpText: "The application's own hiring project, to list its stages." }),
      stageField({ required: true })
    ],
    perform: async (z, bundle) => {
      const response = await z.request({
        url: url(`/hiring/applications/${encodeURIComponent(bundle.inputData.application_id)}/move-stage/v1`),
        method: 'POST',
        body: { com_stage_id: bundle.inputData.com_stage_id }
      })
      return response.data
    },
    sample: { id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3', com_stage_id: '5b8d1e92-3a7c-4c60-b2f4-91e6a0d7c358' }
  }
}

const reject = {
  key: 'reject_application',
  noun: 'Application',
  display: {
    label: 'Reject Application',
    description:
      "Moves an application into its project's Rejected stage. Nothing is deleted. Emails the candidate if your team switched that on for the stage."
  },
  operation: {
    inputFields: [applicationIdField],
    perform: async (z, bundle) => {
      const response = await z.request({
        url: url(`/hiring/applications/${encodeURIComponent(bundle.inputData.application_id)}/reject/v1`),
        method: 'POST'
      })
      return response.data
    },
    sample: {
      id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3',
      status: 'rejected',
      com_stage_id: '9e7a4d31-6b02-4f85-8c19-3a5d70e2b6c4'
    }
  }
}

module.exports = [addApplication, moveStage, reject]
