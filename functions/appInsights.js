const instrumentationKey = "dcbf5901-f73c-4013-a317-0eae6b0050b3";

module.exports = function () {
    let appInsights = require("applicationinsights");
    appInsights.setup(instrumentationKey)
        .setAutoCollectExceptions(true)
        .setAutoCollectConsole(false)
        .setAutoCollectPerformance(false)
        .setAutoCollectRequests(false)
        .setAutoCollectDependencies(false)
        .setAutoDependencyCorrelation(false)
        .start();

    const client = appInsights.defaultClient;
    client.config.maxBatchIntervalMs = 0
    return client;
}