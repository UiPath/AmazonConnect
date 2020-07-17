// Use this code snippet in your app.
// If you need more information about configurations or implementing the sample code, visit the AWS docs:
// https://aws.amazon.com/developers/getting-started/nodejs/

// Load the AWS SDK
const url = require('url');
const https = require('https')
const { getSecret, updateSecret } = require('./secretManager.js');
const { SOURCE } = require('./constants.js');
const initAppInsights = require('./appInsights.js');

function getReason(err) {
	if (err)
		return err.message;
	else
		return '';
}

async function sendResponse(event, context, status, err) {
	return new Promise((resolve, reject) => {
		// only send response when called via CFT
		if (!event.ResponseURL || !event.StackId || !event.RequestId || !event.LogicalResourceId) {
			return;
		}

		var responseBody = {
			StackId: event.StackId,
			RequestId: event.RequestId,
			LogicalResourceId: event.LogicalResourceId,
			PhysicalResourceId: context.logStreamName,
			Status: status,
			Reason: getReason(err) + " See details in CloudWatch Log: " + context.logStreamName,
		};

		console.log("RESPONSE:\n", responseBody);
		var json = JSON.stringify(responseBody);
		var parsedUrl = url.parse(event.ResponseURL);
		var options = {
			hostname: parsedUrl.hostname,
			port: 443,
			path: parsedUrl.path,
			method: "PUT",
			headers: {
				"content-type": "",
				"content-length": json.length
			}
		};

		var request = https.request(options, function (response) {
			console.log("STATUS: " + response.statusCode);
			console.log("HEADERS: " + JSON.stringify(response.headers));
			context.done(null, null);
		});

		request.on("error", function (error) {
			console.log("sendResponse Error:\n", error);
			context.done(error);
		});

		request.on("end", function () {
			console.log("end");
			resolve();
		});

		request.write(json);
		request.end();
	});
}

async function getNewAccessToken(authUrl, client_id, user_key) {
	let apiAccessAuthOptions = url.parse(authUrl);
	let apiAccessAuthBody = JSON.stringify({
		grant_type: 'refresh_token',
		client_id,
		refresh_token: user_key,
	});

	apiAccessAuthOptions.method = 'POST';
	apiAccessAuthOptions.headers = {
		'Content-Type': 'application/json',
		'Content-Length': apiAccessAuthBody.length
	};

	return new Promise((resolve, reject) => {
		let apiAccessAuthReq = https.request(apiAccessAuthOptions, function (res) {
			res.setEncoding('utf8');
			res.on('data', function (res) {
				let tokensObj = JSON.parse(res);
				if (!tokensObj.access_token) {
					throw 'access_token not found';
				}

				resolve(tokensObj.access_token);
			});
		});

		apiAccessAuthReq.on('error', reject);
		apiAccessAuthReq.write(apiAccessAuthBody)
		apiAccessAuthReq.end();
	});
}

exports.handler = async (event, context) => {
	let client_id;
	let user_key;
	let lambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME;
    const appInsightsClient = initAppInsights();

	try {
		client_id = await getSecret(process.env.api_access_key_client_id_secret_id);
		user_key = await getSecret(process.env.api_access_key_user_key_secret_id);
	} catch (err) {
		await sendResponse(event, context, 'FAILED', err);
		throw err;
	}

	try {
		const access_token = await getNewAccessToken(process.env.api_access_auth_url, client_id, user_key);
		await updateSecret(process.env.access_token_secret_id, access_token);

		appInsightsClient.trackEvent({
			name: 'Authenticate',
			properties: {
				source: SOURCE,
                accountName: process.env.accountName,
                tenantName: process.env.tenantName,
			}
		});

		await appInsightsClient.flush();
		await sendResponse(event, context, 'SUCCESS');
	} catch (err) {
		await sendResponse(event, context, 'FAILED', err);
		appInsightsClient.trackException({
			exception: err, measurements: {
				source: SOURCE,
				lambdaName,
                accountName: process.env.accountName,
                tenantName: process.env.tenantName,
			}
		});
		await appInsightsClient.flush();
		
		throw err;
	}
};
