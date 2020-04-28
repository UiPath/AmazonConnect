using Amazon.Lambda;
using Amazon.Lambda.Core;
using Amazon.Lambda.Model;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.Json.JsonSerializer))]

namespace StartJob
{
    public class StartJobFunctionInput
    {
        public string AccessToken { get; set; }
        public string ClientId { get; set; }
        public string UserKey { get; set; }
        public string AccountName { get; set; }
        public string TenantName { get; set; }
        public int OrganizationUnitId { get; set; }
        public string ProcessName { get; set; }
        public Guid ReleaseKey { get; set; }
        public JToken InputArguments { get; set; }
        public bool RequestNewToken { get; set; }

        public StartJobFunctionInput(JObject jsonInput)
        {
            JToken accessToken = jsonInput["Details"]["Parameters"]["accessToken"];
            JToken clientId = jsonInput["Details"]["Parameters"]["clientId"];
            JToken userKey = jsonInput["Details"]["Parameters"]["userKey"];
            JToken accountName = jsonInput["Details"]["Parameters"]["accountName"];
            JToken tenantName = jsonInput["Details"]["Parameters"]["tenantName"];
            JToken organizationUnitId = jsonInput["Details"]["Parameters"]["organizationUnitId"];
            JToken processName = jsonInput["Details"]["Parameters"]["processName"];
            JToken releaseKey = jsonInput["Details"]["Parameters"]["releaseKey"];
            JToken inputArguments = jsonInput["Details"]["Parameters"]["inputArguments"];

            if (accessToken != null)
            {
                AccessToken = accessToken.ToString();
                ClientId = null;
                UserKey = null;
            }
            else
            {
                AccessToken = null;
                ClientId = clientId != null ? clientId.ToString() : throw new ArgumentNullException(nameof(clientId));
                UserKey = userKey != null ? userKey.ToString() : throw new ArgumentNullException(nameof(userKey));
            }

            AccountName = accountName != null ? accountName.ToString() : throw new ArgumentNullException(nameof(accountName));
            TenantName = tenantName != null ? tenantName.ToString() : throw new ArgumentNullException(nameof(tenantName));

            if (releaseKey != null)
            {
                ReleaseKey = new Guid(releaseKey.ToString());
                ProcessName = null;
            }
            else
            {
                ReleaseKey = Guid.Empty;
                ProcessName = processName != null ? processName.ToString() : throw new ArgumentNullException(nameof(processName));
            }

            OrganizationUnitId = (organizationUnitId != null) ? Convert.ToInt32(organizationUnitId.ToString()) : throw new ArgumentNullException(nameof(organizationUnitId));

            InputArguments = (inputArguments != null) ? inputArguments : null;

            var parsedToken = jsonInput["Details"]["Parameters"]["requestNewToken"];
            RequestNewToken = (parsedToken != null) ? Convert.ToBoolean(parsedToken.ToString()) : false;
        }

        public override string ToString()
        {
            return String.Format("{0} {1} {2} {3} {4} {5}", AccessToken, AccountName, TenantName, OrganizationUnitId, ReleaseKey, InputArguments);
        }
    }

    public class StartJobFunctionOutput
    {
        public string AccessToken { get; set; }
        public Guid ReleaseKey { get; set; }
        public Guid JobKey { get; set; }
    }

    class StartInfo
    {
        public Guid ReleaseKey;
        public string Strategy;
        public int JobsCount;
        public JToken InputArguments;
    }

    class StartJob
    {
        public StartInfo startInfo;
    }

    public class Function
    {
        private static Dictionary<string, string> AccessTokens = new Dictionary<string, string>();
        public static Dictionary<string, Guid> ReleaseKeys = new Dictionary<string, Guid>();

        public async Task<StartJobFunctionOutput> FunctionHandler(JObject jsonInput, ILambdaContext context)
        {
            context.Logger.LogLine("JSON Inputs: " + jsonInput.ToString());
            StartJobFunctionInput input = new StartJobFunctionInput(jsonInput);

            string accessToken = input.AccessToken;
            if (input.RequestNewToken)
            {
                context.Logger.LogLine("Clearing access token");
                AccessTokens.Remove(input.ClientId);
                accessToken = null;
            }
            if (String.IsNullOrEmpty(accessToken))
            {
                if (!AccessTokens.TryGetValue(input.ClientId, out accessToken))
                {
                    context.Logger.LogLine("Requesting new access Token...");

                    AmazonLambdaClient client = new AmazonLambdaClient();
                    InvokeRequest ir = new InvokeRequest
                    {
                        FunctionName = "UiPathOrchestratorAuthenticate",
                        InvocationType = InvocationType.RequestResponse,
                        Payload = JsonConvert.SerializeObject(jsonInput, Formatting.Indented)
                    };
                    InvokeResponse invokeResponse = await client.InvokeAsync(ir);
                    if (invokeResponse.HttpStatusCode == System.Net.HttpStatusCode.OK)
                    {
                        var sr = new StreamReader(invokeResponse.Payload);
                        string response = sr.ReadToEnd();
                        var authResponse = JsonConvert.DeserializeObject<JObject>(response);
                        accessToken = authResponse["AccessToken"].ToString();
                        AccessTokens.Add(input.ClientId, accessToken);

                        JObject parameters = (JObject)jsonInput["Details"]["Parameters"];
                        parameters.Add("accessToken", accessToken);

                        context.Logger.LogLine("Access Token: " + accessToken);
                    }
                    else
                    {
                        context.Logger.LogLine("Authentication failed");
                        AccessTokens.Remove(input.ClientId);
                        throw new ApplicationException("Unable to authenticate: " + invokeResponse.FunctionError);
                    }
                }
                else
                {
                    context.Logger.LogLine("Existing Access Token: " + accessToken);
                }
            }

            string key = String.Format("{0}/{1}", input.OrganizationUnitId, input.ProcessName);
            Guid releaseKey = input.ReleaseKey;
            if (releaseKey != Guid.Empty)
            {
                context.Logger.LogLine("Skipping lookup for release key as it was already passed in");
            }
            else
            {
                if (!ReleaseKeys.TryGetValue(key, out releaseKey))
                {
                    context.Logger.LogLine("Retrieving release key...");

                    AmazonLambdaClient client = new AmazonLambdaClient();
                    InvokeRequest ir = new InvokeRequest
                    {
                        FunctionName = "UiPathOrchestratorQueryReleaseKey",
                        InvocationType = InvocationType.RequestResponse,
                        Payload = JsonConvert.SerializeObject(jsonInput, Formatting.Indented)
                    };
                    InvokeResponse invokeResponse = await client.InvokeAsync(ir);
                    if (invokeResponse.HttpStatusCode == System.Net.HttpStatusCode.OK)
                    {
                        var sr = new StreamReader(invokeResponse.Payload);
                        string response = sr.ReadToEnd();
                        var getKeyResponse = JsonConvert.DeserializeObject<JObject>(response);
                        releaseKey = new Guid(getKeyResponse["ReleaseKey"].ToString());
                        ReleaseKeys.Add(key, releaseKey);
                        context.Logger.LogLine("Release Key: " + releaseKey);
                    }
                    else
                    {
                        context.Logger.LogLine("Retrieving the release key failed");
                        ReleaseKeys.Remove(key);
                        throw new ApplicationException("Unable to retrieve Release Key: " + invokeResponse.FunctionError);
                    }
                }
                else
                {
                    context.Logger.LogLine("Existing Release Key: " + releaseKey);
                }
            }

            var startJobData = new StartJob
            {
                startInfo = new StartInfo
                {
                    ReleaseKey = releaseKey,
                    Strategy = "JobsCount",
                    JobsCount = 1
                }
            };
            if (input.InputArguments != null) {
                startJobData.startInfo.InputArguments = input.InputArguments;
            }
            var data = new StringContent(JsonConvert.SerializeObject(startJobData), Encoding.UTF8, "application/json");
            context.Logger.LogLine("RunJob json body: " + JsonConvert.SerializeObject(startJobData));

            string platformEndpoint = System.Environment.GetEnvironmentVariable("PlatformURL");
            var runJobUrl = String.Format("{0}/{1}/{2}/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs", platformEndpoint, input.AccountName, input.TenantName);

            var jobKey = Guid.Empty;
            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                httpClient.DefaultRequestHeaders.Add("X-UIPATH-TenantName", input.TenantName);
                httpClient.DefaultRequestHeaders.Add("X-UIPATH-OrganizationUnitId", input.OrganizationUnitId.ToString());
                var response = await httpClient.PostAsync(runJobUrl, data);
                if (response.IsSuccessStatusCode)
                {
                    string result = response.Content.ReadAsStringAsync().Result;

                    dynamic parsedJson = JObject.Parse(result);
                    string extractedKey = parsedJson.value[0].Key;
                    jobKey = Guid.Parse(extractedKey);
                }
                else
                {
                    context.Logger.LogLine("Failed to Start Job");
                    string responseContent = await response.Content.ReadAsStringAsync();
                    context.Logger.LogLine("Response content:" + responseContent);
                    throw new ApplicationException(response.ReasonPhrase);
                }
            }

            StartJobFunctionOutput output = new StartJobFunctionOutput {
                AccessToken = accessToken,
                ReleaseKey = releaseKey,
                JobKey = jobKey
            };
            context.Logger.LogLine("Output:" + JsonConvert.SerializeObject(output));
            return output;
        }
    }
}
