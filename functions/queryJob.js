const AWS = require('aws-sdk');
const https = require('https');
const url = require('url');
const initAppInsights = require('./appInsights.js');

const client = new AWS.SecretsManager();

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

async function getJob(jobUrl, tenantName, folderId, access_token) {
    return new Promise((resolve, reject) => {
        let getJobStatusOptions = url.parse(jobUrl);
        getJobStatusOptions.method = 'GET';
        getJobStatusOptions.headers = {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'X-UIPATH-TenantName': tenantName,
            'X-UIPATH-OrganizationUnitId': folderId
        };
        
        const start = new Date();
        const req = https.request(getJobStatusOptions, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                // If we know it's JSON, parse it
                if (res.headers['content-type'].startsWith('application/json')) {
                    body = JSON.parse(body);
                }
                
                if(res.statusCode < 200 || res.statusCode >= 300) {
                    reject(`HTTP call to '${jobUrl}' failed with statusCode ${res.statusCode}`);
                }
                
                resolve({ data: body, duration: (new Date() - start), statusCode: res.statusCode });
            });
        });
        
        req.on('error', reject);
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
    const appInsightsClient = initAppInsights(process.env.appInsightsKey);

    let orchestratorUrl = process.env.orchestratorUrl;
    let accountName = process.env.accountName;
    let tenantName = process.env.tenantName;
    let jobKey = event.Parameters.jobKey;
    let folderId = event.Parameters.folderId;

    const queryJobUrl = `${orchestratorUrl}/${accountName}/${tenantName}/odata/Jobs(${jobKey})`;

    let queryJob;
    try {
        const access_token = await getSecret(process.env.access_token_secret_id);
        queryJob = await getJob(queryJobUrl, tenantName, folderId, access_token);
    } catch (err) {
        appInsightsClient.trackException({exception: err, measurements: {
            accountName,
            tenantName
        }});
    }

    if (!queryJob) {
        return null
    }
    
    appInsightsClient.trackEvent({
        name: "QueryJob", 
        properties: {
            accountName,
            tenantName,
            responseTime: queryJob.duration,
            statusCode: queryJob.statusCode,
        }
    });

    return queryJob.data;
};
