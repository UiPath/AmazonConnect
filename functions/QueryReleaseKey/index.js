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
        
        const req = https.request(getReleaseKeyOptions, (res) => {
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
    let processName = event.processName;
    let folderId = event.folderId;
    let access_token = await getSecret(process.env.access_token_secret_id);

    let encodedProcessName = encodeURI(processName);
    const releaseUrl = `${orchestratorUrl}/${accountName}/${tenantName}/odata/Releases?$filter=Name%20eq%20'${encodedProcessName}'`;
    return await getRelease(releaseUrl, tenantName, folderId, access_token);
};
