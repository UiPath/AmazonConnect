const https = require('https');
const url = require('url');
const initAppInsights = require('./appInsights.js');
const { getSecret } = require('./secretManager.js');
const { SOURCE } = require('./constants.js');

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

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(`HTTP call to '${jobUrl}' failed with statusCode ${res.statusCode}`);
                }

                resolve({ data: body, duration: (new Date() - start), statusCode: res.statusCode });
            });
        });

        req.on('error', reject);
        req.end();
    });
}

function flatten(data, response = {}, flatKey = "") {
    for (const [key, value] of Object.entries(data)) {
        const newFlatKey = `${flatKey}${key}`;
        if (typeof value === "object" && value !== null && Object.keys(value).length > 0) {
            flatten(value, response, `${newFlatKey}`);
        } else {
            response[newFlatKey] = value;
        }
    }
    return response;
};

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
    let jobKey = event.Details.Parameters.jobKey;
    let folderId = event.Details.Parameters.folderId;

    const queryJobUrl = `${orchestratorUrl}/${accountName}/${tenantName}/odata/Jobs(${jobKey})`;

    let queryJob;
    try {
        const access_token = await getSecret(process.env.access_token_secret_id);
        queryJob = await getJob(queryJobUrl, tenantName, folderId, access_token);
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

    if (!queryJob) {
        return null
    }

    appInsightsClient.trackEvent({
        name: "QueryJob",
        properties: {
            source: SOURCE,
            lambdaName,
            contactId,
            accountName,
            tenantName,
            responseTime: queryJob.duration,
            statusCode: queryJob.statusCode,
        }
    });

    await appInsightsClient.flush();

    let output = {
        State: queryJob.data.State,
        OutputArguments: JSON.parse(queryJob.data.OutputArguments),
        jobKey
    };

    output = flatten(output);

    return output;
};
