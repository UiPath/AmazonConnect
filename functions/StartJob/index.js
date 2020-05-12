const AWS = require('aws-sdk');
const https = require('https');
const url = require('url');

var client = new AWS.SecretsManager();

async function getSecret(secretId, callback) {
    return new Promise((resolve, reject) => {
        client.getSecretValue({ SecretId: secretId }, function (err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.SecretString);
            }
        });
    });
}

async function startJob(startJobUrl, releaseKey, jobInputArguments, tenantName, folderId, access_token) {
	let startJobData = {
		startInfo: {
			ReleaseKey: releaseKey,
			Strategy: "JobsCount",
			JobsCount: 1,
			InputArguments: jobInputArguments
		}
	};
	let data = JSON.stringify(startJobData);
    return new Promise((resolve, reject) => {
        let getJobStatusOptions = url.parse(startJobUrl);
        getJobStatusOptions.method = 'POST';
        getJobStatusOptions.headers = {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'X-UIPATH-TenantName': tenantName,
            'X-UIPATH-OrganizationUnitId': folderId,
			'Content-Length': data.length
        };
        
        const req = https.request(getJobStatusOptions, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                // If we know it's JSON, parse it
                if (res.headers['content-type'].startsWith('application/json')) {
                    body = JSON.parse(body);
                }
                resolve(body);
            });
        });
        
        req.on('error', reject);
		req.write(data);
        req.end();
    });
}

/**
 * Pass the data to send as `event.data`, and the request options as
 * `event.options`. For more information see the HTTPS module documentation
 * at https://nodejs.org/api/https.html.
 *
 * Will succeed with the response body.
 */
exports.handler = async (event, context, callback) => {
    let orchestratorUrl = process.env.orchestratorUrl;
    let accountName = process.env.accountName;
    let tenantName = process.env.tenantName;
    let releaseKey = event.releaseKey;
    let folderId = event.folderId;
	let jobInputArguments = JSON.stringify(event.inputArguments || {});
    let access_token = await getSecret(process.env.access_token_secret_id);
	let startJobUrl = `${orchestratorUrl}/${accountName}/${tenantName}/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs`;
	
    return await startJob(startJobUrl, releaseKey, jobInputArguments, tenantName, folderId, access_token);
};
