import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import contract from './contract.json';

/** Kept equal to package.json's version by a test; sent so Flowmingo can tell which connector made a call. */
export const CONNECTOR_VERSION = '0.1.0';

export const BASE_URL = contract.base_url;

type FlowmingoContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

type FullResponse = { statusCode: number; body: unknown };

/**
 * Calls the Flowmingo public API with the node's credential. Every error answers { statusCode, message, code? }
 * (docs §8.4), so the node shows that message and keeps the status and code for routing on, never the wording.
 */
export async function flowmingoApiRequest(
	this: FlowmingoContext,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject; itemIndex?: number } = {},
): Promise<IDataObject> {
	const request: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		headers: {
			'user-agent': `n8n-nodes-flowmingo/${CONNECTOR_VERSION}`,
			accept: 'application/json',
		},
		qs: options.qs,
		body: options.body,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	const response = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'flowmingoApi',
		request,
	)) as FullResponse;
	const body = (
		response.body && typeof response.body === 'object' ? response.body : {}
	) as IDataObject;

	if (response.statusCode >= 400) {
		// A refused key is the one error the user fixes in n8n itself, so it says where; the API's own words follow.
		const apiMessage =
			typeof body.message === 'string' ? body.message : `Flowmingo answered ${response.statusCode}`;
		const message =
			response.statusCode === 401
				? `Flowmingo did not accept the API key (${apiMessage}). It may have been revoked or disabled: update the Flowmingo API credential with a valid key from Settings > API keys.`
				: apiMessage;
		throw new NodeApiError(this.getNode(), body as JsonObject, {
			httpCode: String(response.statusCode),
			message,
			description: typeof body.code === 'string' ? `Code: ${body.code}` : undefined,
			itemIndex: options.itemIndex,
		});
	}
	return body;
}

/** The `data` array of a list answer, or an empty list. */
export const rowsOf = (body: IDataObject): IDataObject[] =>
	Array.isArray(body.data) ? (body.data as IDataObject[]) : [];
