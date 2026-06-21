function refreshRuntimeSettings(settingsModulePath) {
    const resolvedPath = require.resolve(settingsModulePath);

    const cachedModule = require.cache[resolvedPath];
    const runtimeRef = cachedModule && cachedModule.exports
        ? cachedModule.exports
        : require(settingsModulePath);

    delete require.cache[resolvedPath];
    const latest = require(settingsModulePath);

    if (runtimeRef && typeof runtimeRef === 'object') {
        for (const key of Object.keys(runtimeRef)) {
            delete runtimeRef[key];
        }
        Object.assign(runtimeRef, latest);
    }

    if (require.cache[resolvedPath]) {
        require.cache[resolvedPath].exports = runtimeRef;
    }

    return runtimeRef;
}

function getCurrentSettings(settingsModulePath) {
    const resolvedPath = require.resolve(settingsModulePath);
    const cachedModule = require.cache[resolvedPath];
    if (cachedModule && cachedModule.exports) {
        return cachedModule.exports;
    }
    return require(settingsModulePath);
}

module.exports = {
    refreshRuntimeSettings,
    getCurrentSettings,
};
