const { exec, spawn } = require('child_process');
const path = require('path');
const { GUMTREE_CMD, WEBDIFF_MIN_INTERVAL_MS } = require('./watch-ast-config');

let webdiffProcess = null;
let lastWebDiffLaunch = 0;
let pendingWebDiffPair = null;
let pendingWebDiffTimer = null;

function launchWebDiff(oldPath, newPath) {
    const now = Date.now();
    const elapsed = now - lastWebDiffLaunch;

    if (elapsed < WEBDIFF_MIN_INTERVAL_MS) {
        // Too soon — remember this pair as the "latest pending" one,
        // and (re)schedule a trailing launch for when the window closes.
        pendingWebDiffPair = { oldPath, newPath };

        if (pendingWebDiffTimer) {
            clearTimeout(pendingWebDiffTimer);
        }

        const remaining = WEBDIFF_MIN_INTERVAL_MS - elapsed;
        pendingWebDiffTimer = setTimeout(() => {
            pendingWebDiffTimer = null;
            const pair = pendingWebDiffPair;
            pendingWebDiffPair = null;
            if (pair) {
                doLaunchWebDiff(pair.oldPath, pair.newPath);
            }
        }, remaining);

        console.log('  -> webdiff throttled, trailing launch scheduled in', remaining, 'ms');
        return;
    }

    doLaunchWebDiff(oldPath, newPath);
}

function doLaunchWebDiff(oldPath, newPath) {
    lastWebDiffLaunch = Date.now();

    const launch = () => {
        // Pass the executable and args separately — with shell: true, Node
        // quotes each argument correctly on its own, avoiding the manual
        // nested-quote string-building that kept breaking with "start".
        webdiffProcess = spawn(
            GUMTREE_CMD,
            ['webdiff', oldPath, newPath],
            {
                shell: true,
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            }
        );

        webdiffProcess.on('error', (err) => {
            console.log('  -> webdiff spawn error:', err.message);
        });

        webdiffProcess.unref();

        console.log(`  -> webdiff launched (hidden, background): ${path.basename(oldPath)} vs ${path.basename(newPath)}`);
        console.log('  -> open http://127.0.0.1:4567 in your browser');
    };

    if (webdiffProcess && webdiffProcess.pid) {
        const oldPid = webdiffProcess.pid;
        exec(`taskkill /PID ${oldPid} /T /F`, (err) => {
            if (err) {
                console.log('  -> taskkill note (likely already exited):', err.message);
            }
            webdiffProcess = null;
            launch();
        });
    } else {
        launch();
    }
}

module.exports = {
    launchWebDiff
};