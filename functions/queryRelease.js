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

async function getRelease(releaseUrl, tenantName, folderId, access_token) {
    return new Promise((resolve, reject) => {
        let getReleaseKeyOptions = url.parse(releaseUrl);
        getReleaseKeyOptions.method = 'GET';
        getReleaseKeyOptions.headers = {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
            'X-UIPATH-TenantName': tenantName,
            'X-UIPATH-OrganizationUnitId': folderId
        };
        
        const start = new Date();
        const req = https.request(getReleaseKeyOptions, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                // If we know it's JSON, parse it
                if (res.headers['content-type'].startsWith('application/json')) {
                    body = JSON.parse(body);
                }
                
                if(res.statusCode < 200 || res.statusCode >= 300) {
                    reject(`HTTP call to '${releaseUrl}' failed with statusCode ${res.statusCode}`);
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
    let processName = event.Parameters.processName;
    let folderId = event.Parameters.folderId;
    let encodedProcessName = encodeURI(processName);
    
    let release;
    try {
        const access_token = await getSecret(process.env.access_token_secret_id);
        const releaseUrl = `${orchestratorUrl}/${accountName}/${tenantName}/odata/Releases?$filter=startswith(Name,'${encodedProcessName}')`;
        release = await getRelease(releaseUrl, tenantName, folderId, access_token);
    } catch (err) {
        appInsightsClient.trackException({exception: err, measurements: {
            accountName,
            tenantName
        }});
    }

    if (!release) {
        return null;
    }
    
    appInsightsClient.trackEvent({
        name: "QueryRelease", 
        properties: {
            accountName,
            tenantName,
            responseTime: release.duration,
            statusCode: release.statusCode,
        }
    });
    
    return release.data;
};
