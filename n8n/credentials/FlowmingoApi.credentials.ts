import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class FlowmingoApi implements ICredentialType {
	name = 'flowmingoApi';

	displayName = 'Flowmingo API';

	icon: Icon = { light: 'file:flowmingo.svg', dark: 'file:flowmingo.dark.svg' };

	documentationUrl = 'https://flowmingo.ai/integration/api-integration';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create a key in Flowmingo under Settings > API keys. It starts with fl_. The trigger needs a key created by an Owner or Admin.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://apis.flowmingo.ai/company/integration',
			url: '/me/v1',
			method: 'GET',
		},
		// Without a rule n8n shows only the status text ("Unauthorized").
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Flowmingo did not accept this API key. It may have been revoked or disabled: copy a valid key from Settings > API keys.',
				},
			},
		],
	};
}
