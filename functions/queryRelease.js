const https = require('https');
const url = require('url');
const initAppInsights = require('./appInsights.js');
const { getSecret } = require('./secretManager.js');
const { SOURCE } = require('./constants.js');

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

                if (res.statusCode < 200 || res.statusCode >= 300) {
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
    const appInsightsClient = initAppInsights();

    let orchestratorUrl = process.env.orchestratorUrl;
    let accountName = process.env.accountName;
    let tenantName = process.env.tenantName;
    let lambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME;
    let contactId = (event.Details.ContactData || {}).ContactId;
    let processName = event.Details.Parameters.processName;
    let folderId = event.Details.Parameters.folderId;
    let encodedProcessName = encodeURI(processName);

    let release;
    try {
        const access_token = await getSecret(process.env.access_token_secret_id);
        const releaseUrl = `${orchestratorUrl}/${accountName}/${tenantName}/odata/Releases?$filter=Name%20eq%20'${encodedProcessName}')`;
        release = await getRelease(releaseUrl, tenantName, folderId, access_token);
    } catch (err) {
        appInsightsClient.trackException({
            exception: err,
            measurements: {
                source: SOURCE,
                lambdaName,
                contactId,
                accountName,
                tenantName
            }
        });
        await appInsightsClient.flush();

        throw err;
    }

    if (!release) {
        return null;
    }

    appInsightsClient.trackEvent({
        name: "QueryRelease",
        properties: {
            source: SOURCE,
            lambdaName,
            contactId,
            accountName,
            tenantName,
            responseTime: release.duration,
            statusCode: release.statusCode,
        }
    });

    await appInsightsClient.flush();

    return {
        releaseKey: release.data.value[0].Key
    };
};
