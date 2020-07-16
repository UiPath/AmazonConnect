const https = require('https');
const url = require('url');
const initAppInsights = require('./appInsights.js');
const { getSecret } = require('./secretManager.js');
const { SOURCE, FOLDER_TYPE_CLASSIC, FOLDER_TYPE_MODERN } = require('./constants.js');

async function startJob(startJobUrl, releaseKey, jobInputArguments, tenantName, folderId, folderType, access_token) {
    let Strategy;

    folderType = folderType.toLowerCase()
    switch (folderType) {
        case FOLDER_TYPE_CLASSIC: Strategy = 'JobsCount'; break;
        case FOLDER_TYPE_MODERN: Strategy = 'ModernJobsCount'; break;
        default:
            throw new Error(`Invalid value for 'folderType'. Should be either 'Classic' OR 'Modern'.`);
    }

    let startJobData = {
        startInfo: {
            ReleaseKey: releaseKey,
            Strategy,
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
                    reject(`HTTP call to '${startJobUrl}' failed with statusCode ${res.statusCode}`);
                }

                resolve({ data: body, duration: (new Date() - start), statusCode: res.statusCode });
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
    const appInsightsClient = initAppInsights();

    let orchestratorUrl = process.env.orchestratorUrl;
    let accountName = process.env.accountName;
    let tenantName = process.env.tenantName;
    let lambdaName = process.env.AWS_LAMBDA_FUNCTION_NAME;
    let contactId = (event.Details.ContactData || {}).ContactId;
    let releaseKey = event.Details.Parameters.releaseKey;
    let folderId = event.Details.Parameters.folderId;
    let folderType = event.Details.Parameters.folderType || FOLDER_TYPE_CLASSIC;
    let startJobUrl = `${orchestratorUrl}/${accountName}/${tenantName}/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs`;
    let jobInputArguments;

    if (event.Details.Parameters.inputArguments) {
        let jobArguments = JSON.parse(event.Details.Parameters.inputArguments);
        if (!jobArguments) {
            throw new Error('inputArguments not a valid JSON');
        }

        jobInputArguments = JSON.stringify(jobArguments || {});
    }

    let job;
    try {
        const access_token = await getSecret(process.env.access_token_secret_id);
        job = await startJob(startJobUrl, releaseKey, jobInputArguments, tenantName, folderId, folderType, access_token);
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

    if (!job) {
        return null;
    }

    appInsightsClient.trackEvent({
        name: "StartJob",
        properties: {
            source: SOURCE,
            lambdaName,
            contactId,
            accountName,
            tenantName,
            responseTime: job.duration,
            statusCode: job.statusCode,
        }
    });

    await appInsightsClient.flush();

    return {
        jobKey: job.data.value[0].Id,
    };
};
