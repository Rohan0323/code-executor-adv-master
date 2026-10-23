import { exec } from "child_process";
import fs from 'fs'
import { createClient } from "redis";
import { Redis } from "@upstash/redis";
import dotenv from "dotenv";
import { EXTENSIONS, getExecutionCommand } from "./libs.js";
import path from "path";

dotenv.config();
dotenv.config({ path: "../.env" });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (Boolean(UPSTASH_REDIS_REST_URL) !== Boolean(UPSTASH_REDIS_REST_TOKEN)) {
    console.error('Upstash Redis configuration is incomplete; set both REST environment variables');
}

if (!fs.existsSync("executionArea")) {
    fs.mkdirSync("executionArea");
}

const executeCode = async (jobId: string, fileName: string, language: string, code: string) => {
    const jobDir = path.join("executionArea", jobId);

    return new Promise(async (resolve) => {
        const lang = language.toLowerCase();
        if (!(lang in EXTENSIONS)) {
            return resolve({ status: "Error", output: "Unsupported Language" });
        }

        try {
            if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);
            
            const ext = EXTENSIONS[lang as keyof typeof EXTENSIONS];
            const filePath = path.join(jobDir, `${fileName}.${ext}`);
            fs.writeFileSync(filePath, code);

            const command = getExecutionCommand(ext, filePath, fileName, jobDir);

            exec(command, { timeout: 5000, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
                const jobOutput = {
                    status: (err || stderr) ? "Error" : "Success",
                    output: (err?.message || stderr || stdout).trim()
                };
                if (fs.existsSync(jobDir)) {
                    fs.rmSync(jobDir, { recursive: true, force: true });
                }
                
                resolve(jobOutput);
            });

        } catch (e) {
            if (fs.existsSync(jobDir)) {
                fs.rmSync(jobDir, { recursive: true, force: true });
            }
            resolve({ status: "Error", output: String(e) });
        }
    });
}

const startWorker = async () => {
    console.log("Initializing Worker")
    
    const client = createClient({ url: REDIS_URL });
    client.on('error', () => console.error('Local Redis client error'));
    await client.connect();

    const upstashClient = UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN
        ? new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN })
        : undefined;

    const mirrorCompletedJob = async (jobData: Record<string, unknown>) => {
        if (!upstashClient) return false;

        try {
            const jobId = String(jobData.jobId);
            await upstashClient.set(`result:${jobId}`, JSON.stringify(jobData), { ex: 600 });
            await upstashClient.del(`job:${jobId}`);
            return true;
        } catch {
            console.error('Upstash Redis result mirror failed');
            return false;
        }
    };

    while(true){
        
        const submission = await client.brPop("pending", 0);

        if(!submission) continue;

        const jobData = JSON.parse(submission.element)

        const {jobId, fileName, language, code} = jobData
        console.log(`Received job with props as :- ${fileName}, ${language}`)
        console.log(`Execution Initiated for JobId:- ${jobId}`)

        jobData.response = await executeCode(jobId, fileName, language, code);

        try {
            await client.set(`result:${jobId}`, JSON.stringify(jobData), { EX: 600 });
        } catch {
            console.error(`Local Redis result persistence failed for JobId:- ${jobId}`);
            if (!upstashClient) {
                console.error('Upstash Redis recovery unavailable: REST credentials are not configured');
            }
            const recovered = await mirrorCompletedJob(jobData);
            if (!recovered) {
                throw new Error(`Unable to persist result for JobId:- ${jobId}`);
            }
            console.warn(`Result recovered to Upstash Redis for JobId:- ${jobId}`);
            continue;
        }

        // Mirror completion without delaying the local worker queue.
        void mirrorCompletedJob(jobData);
        console.log(`Execution Successfull For JobId:- ${jobId}`)
    }
}

startWorker();