import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { operations } from './actions';
import { fieldProperties, operationProperties, resourceProperty } from './descriptions';
import { getJobPosts, getStages, searchAssessments, searchProjects } from './loadOptions';

// Programmatic rather than declarative: the invite answers 201 with per-candidate refusals that must fail or warn,
// and every route shares one error mapping that keeps the API's own message, status and code.
export class Flowmingo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Flowmingo',
		name: 'flowmingo',
		icon: { light: 'file:flowmingo.svg', dark: 'file:flowmingo.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Invite candidates, move applications and review results in Flowmingo',
		defaults: { name: 'Flowmingo' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'flowmingoApi', required: true }],
		properties: [resourceProperty, ...operationProperties, ...fieldProperties],
	};

	methods = {
		loadOptions: { getJobPosts, getStages },
		listSearch: { searchAssessments, searchProjects },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const run = operations[resource]?.[operation];
				if (!run) {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation ${resource}.${operation}`,
						{
							itemIndex: i,
						},
					);
				}
				const result = await run.call(this, i);
				const rows: IDataObject[] = Array.isArray(result) ? result : [result];
				returnData.push(...rows.map((json) => ({ json, pairedItem: { item: i } })));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Both constructors hand back an error that is already of their kind, so the API's status and code survive.
				if (error instanceof NodeApiError) {
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex: i });
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
