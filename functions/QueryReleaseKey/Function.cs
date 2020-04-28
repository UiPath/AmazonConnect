using Amazon.Lambda;
using Amazon.Lambda.Core;
using Amazon.Lambda.Model;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.Json.JsonSerializer))]

namespace QueryReleaseKey
{
    public class QueryReleaseKeyFunctionInput
    {
        public string AccessToken { get; set; }
        public string ClientId { get; set; }
        public string UserKey { get; set; }
        public string AccountName { get; set; }
        public string TenantName { get; set; }
        public int OrganizationUnitId { get; set; }
        public string ProcessName { get; set; }
        public bool RequestNewToken { get; set; }

        public QueryReleaseKeyFunctionInput(JObject jsonInput)
        {
            JToken accessToken = jsonInput["Details"]["Parameters"]["accessToken"];
            JToken clientId = jsonInput["Details"]["Parameters"]["clientId"];
            JToken userKey = jsonInput["Details"]["Parameters"]["userKey"];
            JToken accountName = jsonInput["Details"]["Parameters"]["accountName"];
            JToken tenantName = jsonInput["Details"]["Parameters"]["tenantName"];
            JToken organizationUnitId = jsonInput["Details"]["Parameters"]["organizationUnitId"];
            JToken processName = jsonInput["Details"]["Parameters"]["processName"];

            if (accessToken != null)
            {
                AccessToken = accessToken.ToString();
                ClientId = null;
                UserKey = null;
            }
            else
            {
                AccessToken = null;
                ClientId = clientId !=null ? clientId.ToString() : throw new ArgumentNullException(nameof(clientId));
                UserKey = userKey !=null ? userKey.ToString() : throw new ArgumentNullException(nameof(userKey));
            }

            AccountName = accountName!=null ? accountName.ToString() : throw new ArgumentNullException(nameof(accountName));
            TenantName = tenantName!=null ? tenantName.ToString() : throw new ArgumentNullException(nameof(tenantName));
            ProcessName = processName!=null ? processName.ToString() : throw new ArgumentNullException(nameof(processName));

            OrganizationUnitId = (organizationUnitId != null) ? Convert.ToInt32(organizationUnitId.ToString()) : throw new ArgumentNullException(nameof(organizationUnitId));

            var parsedToken = jsonInput["Details"]["Parameters"]["requestNewToken"];
            RequestNewToken = (parsedToken != null) ? Convert.ToBoolean(parsedToken.ToString()) : false;
        }
    }

    public class QueryReleaseKeyFunctionOutput
    {
        public string AccessToken { get; set; }
        public Guid ReleaseKey { get; set; }
    }

    public class Function
    {
        private static Dictionary<string, string> AccessTokens = new Dictionary<string, string>();

        public async Task<QueryReleaseKeyFunctionOutput> FunctionHandler(JObject jsonInput, ILambdaContext context)
        {
            QueryReleaseKeyFunctionInput input = new QueryReleaseKeyFunctionInput(jsonInput);

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

            string platformEndpoint = System.Environment.GetEnvironmentVariable("PlatformURL");
            var getReleaseUrl = String.Format("{0}/{1}/{2}/odata/Releases?$select=Name,Key&$filter=contains(Name,'{3}')", platformEndpoint, input.AccountName, input.TenantName, input.ProcessName);

            var releaseKey = Guid.Empty;
            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
                httpClient.DefaultRequestHeaders.Add("X-UIPATH-TenantName", input.TenantName);
                httpClient.DefaultRequestHeaders.Add("X-UIPATH-OrganizationUnitId", input.OrganizationUnitId.ToString());

                context.Logger.LogLine("Getting the Release Key...");
                var response = await httpClient.GetAsync(getReleaseUrl);
                if (response.IsSuccessStatusCode)
                {
                    string result = response.Content.ReadAsStringAsync().Result;

                    dynamic data = JObject.Parse(result);
                    string extractedKey = data.value[0].Key;
                    releaseKey = Guid.Parse(extractedKey);
                }
                else
                {
                    context.Logger.LogLine("Failed to get Release Key");
                    throw new ApplicationException(response.ReasonPhrase);
                }
            }

            QueryReleaseKeyFunctionOutput output = new QueryReleaseKeyFunctionOutput {
                AccessToken = accessToken,
                ReleaseKey = releaseKey
            };
            context.Logger.LogLine("Output:" + JsonConvert.SerializeObject(output));
            return output;
        }
    }
}
