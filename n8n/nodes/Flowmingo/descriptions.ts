import type { INodeProperties } from 'n8n-workflow';

const show = (resource: string, operation: string[]) => ({
	show: { resource: [resource], operation },
});

/**
 * A pick-from-list field whose list loads when the user opens it. A plain dropdown loads as the node opens, and n8n
 * can send that request before it has attached the credential to a node just added; the dropdown then stays on
 * "Error fetching options" until the node is reopened.
 */
const locator = (
	field: Pick<INodeProperties, 'displayName' | 'name' | 'displayOptions' | 'hint'> &
		Partial<Pick<INodeProperties, 'required'>>,
	searchListMethod: string,
): INodeProperties => ({
	...field,
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod, searchable: true },
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 3ac2dfd9-dd77-4484-99b9-bcbf3f9b27d7',
		},
	],
});

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Application', value: 'application' },
		{ name: 'Candidate', value: 'candidate' },
		{ name: 'Project', value: 'project' },
		{ name: 'Result', value: 'result' },
	],
	default: 'candidate',
};

export const operationProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['application'] } },
		options: [
			{
				name: 'Add to Project',
				value: 'add',
				description: 'Put a candidate already in your account into a hiring project',
				action: 'Add a candidate to a hiring project',
			},
			{
				name: 'Move to Stage',
				value: 'moveStage',
				description: 'Move an application to another stage of its project',
				action: 'Move an application to a stage',
			},
			{
				name: 'Reject',
				value: 'reject',
				description: "Move an application into its project's Rejected stage",
				action: 'Reject an application',
			},
		],
		default: 'add',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['candidate'] } },
		options: [
			{
				name: 'Find by Email',
				value: 'findByEmail',
				description: 'Find a candidate in your pipelines by email address',
				action: 'Find a candidate by email',
			},
			{ name: 'Get', value: 'get', description: 'Get one candidate', action: 'Get a candidate' },
			{
				name: 'Invite',
				value: 'invite',
				description: 'Add a candidate and invite them to an assessment, a hiring project, or both',
				action: 'Invite a candidate',
			},
		],
		default: 'invite',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['project'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a hiring project with its default stages and an AI-drafted job post',
				action: 'Create a hiring project',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List your hiring projects',
				action: 'Get many hiring projects',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['result'] } },
		options: [
			{
				name: 'Add Note',
				value: 'addNote',
				description: 'Add a note, and optionally a rating, to a result',
				action: 'Add a note to a result',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get one result with its AI evaluation',
				action: 'Get a result',
			},
			{
				name: 'Rate',
				value: 'rate',
				description: 'Rate a result from 0 to 10',
				action: 'Rate a result',
			},
			{
				name: 'Shortlist',
				value: 'shortlist',
				description: 'Shortlist a result, or remove the shortlist mark',
				action: 'Shortlist a result',
			},
		],
		default: 'get',
	},
];

const candidateFields: INodeProperties[] = [
	locator(
		{
			displayName: 'Assessment',
			name: 'assessmentId',
			displayOptions: show('candidate', ['invite']),
			hint: `An AI Interview, Role-play, CV Evaluation, Skill Test or Technical Test. Pick an assessment, a hiring project, or both.`,
		},
		'searchAssessments',
	),
	locator(
		{
			displayName: 'Hiring Project',
			name: 'projectId',
			displayOptions: show('candidate', ['invite']),
			hint: `Puts the candidate in this pipeline. A Skill Test or Technical Test must be attached to it.`,
		},
		'searchProjects',
	),
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: show('candidate', ['invite']),
		description:
			'Where the invitation goes. Leave empty only when you give a CV link to read it from.',
	},
	{
		displayName: 'Send Invitation',
		name: 'sendInvite',
		type: 'boolean',
		default: true,
		displayOptions: show('candidate', ['invite']),
		description:
			'Whether to email the invitation. Turn off to add the candidate without emailing them.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('candidate', ['invite']),
		options: [
			{
				displayName: 'CV Link',
				name: 'cvLink',
				type: 'string',
				default: '',
				description: 'A public link to the CV. Required to order a CV Evaluation.',
			},
			{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
			{
				displayName: 'Invitation Message',
				name: 'invitationMessage',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'A note added to the invitation email, 10 to 5000 characters',
			},
			{
				displayName: 'Job Post Name or ID',
				name: 'jobPostId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getJobPosts', loadOptionsDependsOn: ['projectId.value'] },
				default: '',
				hint: `The job post the invitation is for.`,
			},
			{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
		],
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		required: true,
		default: '',
		displayOptions: show('candidate', ['findByEmail']),
		description: 'Matched exactly, ignoring capital letters',
	},
	{
		displayName: 'Candidate ID',
		name: 'candidateId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('candidate', ['get']),
	},
];

const applicationFields: INodeProperties[] = [
	{
		displayName: 'Candidate ID',
		name: 'candidateId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('application', ['add']),
		description:
			'A candidate already in your account. To bring in someone new, use Candidate > Invite.',
	},
	locator(
		{
			displayName: 'Hiring Project',
			name: 'projectId',
			required: true,
			displayOptions: show('application', ['add', 'moveStage']),
			hint: `For Move to Stage, the application's own project.`,
		},
		'searchProjects',
	),
	{
		displayName: 'Application ID',
		name: 'applicationId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('application', ['moveStage', 'reject']),
	},
	{
		displayName: 'Stage Name or ID',
		name: 'stageId',
		type: 'options',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['projectId.value'] },
		required: true,
		default: '',
		displayOptions: show('application', ['moveStage']),
		hint: `Emails the candidate if your team switched that on for the stage.`,
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('application', ['add']),
		options: [
			{
				displayName: 'Job Post Name or ID',
				name: 'jobPostId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getJobPosts', loadOptionsDependsOn: ['projectId.value'] },
				default: '',
				hint: `Needed when the project has more than one job post.`,
			},
			{
				displayName: 'Stage Name or ID',
				name: 'stageId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['projectId.value'] },
				default: '',
				hint: `The stage to start in. Leave empty for the first stage.`,
			},
		],
	},
];

const resultFields: INodeProperties[] = [
	{
		displayName: 'Result ID',
		name: 'resultId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('result', ['addNote', 'get', 'rate', 'shortlist']),
		description: 'The result (submission) ID, for example from the Flowmingo Trigger',
	},
	{
		displayName: 'Note',
		name: 'note',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show('result', ['addNote']),
		description: '1 to 2000 characters',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('result', ['addNote']),
		options: [
			{
				displayName: 'Rating',
				name: 'rating',
				type: 'number',
				typeOptions: { minValue: 0.5, maxValue: 10, numberPrecision: 1 },
				default: 8,
				description: 'A rating to save with the note: 0.5 to 10, in steps of 0.5',
			},
		],
	},
	{
		displayName: 'Rating',
		name: 'rating',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 10, numberPrecision: 1 },
		required: true,
		default: 8,
		displayOptions: show('result', ['rate']),
		description: '0 to 10, in steps of 0.5. Replaces the earlier rating by the same person.',
	},
	{
		displayName: 'Shortlisted',
		name: 'shortlisted',
		type: 'boolean',
		default: true,
		displayOptions: show('result', ['shortlist']),
		description: 'Whether the result is shortlisted',
	},
];

const projectFields: INodeProperties[] = [
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('project', ['create']),
		description: 'How your team sees the project, up to 255 characters',
	},
	{
		displayName: 'Position',
		name: 'position',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('project', ['create']),
		description: 'The role being hired for. It becomes the job post title.',
	},
	{
		displayName: 'Unique Key',
		name: 'idempotencyKey',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('project', ['create']),
		description:
			'An ID of this job in your own system, 8 to 128 characters from A-Z a-z 0-9 . _ : -. Sending the same key again returns the same project.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('project', ['create']),
		options: [
			{
				displayName: 'Job Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				description:
					'The job description as text, up to 15000 characters. The job post is drafted from it.',
			},
		],
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: show('project', ['getAll']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { resource: ['project'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

export const fieldProperties: INodeProperties[] = [
	...candidateFields,
	...applicationFields,
	...resultFields,
	...projectFields,
];
