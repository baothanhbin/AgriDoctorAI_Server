const { spawn } = require('child_process');
const path = require('path');
const serverConfig = require('../config/server.config');

let activeInferenceJobs = 0;
const pendingInferenceJobs = [];

function createQueueFullError() {
    const error = new Error('Inference queue is full');
    error.code = 'INFERENCE_QUEUE_FULL';
    return error;
}

function drainInferenceQueue() {
    if (activeInferenceJobs >= serverConfig.MAX_CONCURRENT_INFERENCE) {
        return;
    }

    const nextJob = pendingInferenceJobs.shift();
    if (nextJob) {
        nextJob();
    }
}

function enqueueInferenceTask(task) {
    return new Promise((resolve, reject) => {
        const startTask = () => {
            activeInferenceJobs += 1;
            Promise.resolve()
                .then(task)
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    activeInferenceJobs = Math.max(0, activeInferenceJobs - 1);
                    drainInferenceQueue();
                });
        };

        if (activeInferenceJobs < serverConfig.MAX_CONCURRENT_INFERENCE) {
            startTask();
            return;
        }

        if (pendingInferenceJobs.length >= serverConfig.MAX_PENDING_INFERENCE) {
            reject(createQueueFullError());
            return;
        }

        pendingInferenceJobs.push(startTask);
    });
}

function runPythonScript(pythonScript, imagePath) {
    return new Promise((resolve, reject) => {
        const pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
        const child = spawn(pythonExecutable, [pythonScript, imagePath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let didTimeout = false;
        const timeout = setTimeout(() => {
            didTimeout = true;
            child.kill('SIGKILL');
        }, 120_000);

        child.stdout.on('data', chunk => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });

        child.on('error', error => {
            clearTimeout(timeout);
            reject(error);
        });

        child.on('close', code => {
            clearTimeout(timeout);

            if (stderr) {
                console.log('Python STDERR:', stderr);
            }

            if (didTimeout) {
                return reject(new Error('Python inference timed out'));
            }

            if (code !== 0) {
                return reject(new Error(`Python process exited with code ${code}`));
            }

            return resolve(stdout);
        });
    });
}

function runClassify(imagePath) {
    return enqueueInferenceTask(() => new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, '..', '..', 'python', 'classify.py');

        runPythonScript(pythonScript, imagePath)
            .then(stdout => {
                try {
                    resolve(JSON.parse(stdout));
                } catch (parseError) {
                    console.error('Loi parse JSON:', parseError);
                    console.error('Output:', stdout);
                    reject(parseError);
                }
            })
            .catch(error => {
                console.error('Loi chay classification:', error);
                reject(error);
            });
    }));
}

function runModel(imagePath) {
    return enqueueInferenceTask(() => new Promise((resolve, reject) => {
        const pythonScript = path.join(__dirname, '..', '..', 'python', 'inference.py');

        runPythonScript(pythonScript, imagePath)
            .then(stdout => {
                try {
                    const jsonStartIndex = stdout.indexOf('{');
                    const jsonEndIndex = stdout.lastIndexOf('}');

                    if (jsonStartIndex === -1 || jsonEndIndex === -1) {
                        throw new Error('Khong tim thay JSON trong output cua Python');
                    }

                    const cleanJson = stdout.substring(jsonStartIndex, jsonEndIndex + 1);
                    resolve(JSON.parse(cleanJson));
                } catch (parseError) {
                    console.error('Loi parse JSON:', parseError);
                    console.error('Output:', stdout);
                    reject(parseError);
                }
            })
            .catch(error => {
                console.error('Loi thuc thi model:', error);
                reject(error);
            });
    }));
}

module.exports = {
    runClassify,
    runModel
};
