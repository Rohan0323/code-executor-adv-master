import express, { type NextFunction } from 'express'
import type { Request, Response } from 'express';
import { createClient } from "redis";
import { Redis } from "@upstash/redis";
import dotenv from "dotenv";
import { v4 } from 'uuid';
import { Job } from './job.js';
import cors from 'cors'
import type {CorsOptions} from "cors"

dotenv.config();

const whitelist = ['http://localhost:5173', 'https://group-code.vercel.app', 'https://codesync.saish.tech', 'https://www.saish.tech'];

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (Boolean(UPSTASH_REDIS_REST_URL) !== Boolean(UPSTASH_REDIS_REST_TOKEN)) {
    console.error('Upstash Redis configuration is incomplete; set both REST environment variables');
}

const corsOptions : CorsOptions = {
    origin : function (origin, callback){
        if(!origin || whitelist.indexOf(origin) != -1){
            callback(null, true)
        }
        else{
            console.log("Blocked by CORS:", origin);
            callback(new Error('Not Allowed By Cors'))
        }
    }
}

const app = express();

app.use(cors(corsOptions));

const client = createClient({ url: REDIS_URL });
client.on('error', () => console.error('Local Redis client error'));
await client.connect();

const upstashClient = UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN })
    : undefined;

const getUpstashResult = async (key: string) => {
    if (!upstashClient) return null;

    try {
        return await upstashClient.get<string>(key);
    } catch {
        console.error('Upstash Redis result lookup failed');
        return null;
    }
};

const mirrorJobToUpstash = async (job: JOB_TYPE) => {
    if (!upstashClient) return;

    try {
        await upstashClient.set(`job:${job.jobId}`, JSON.stringify(job));
    } catch {
        console.error('Upstash Redis job mirror failed');
    }
};

type JOB_TYPE = {
    jobId : string,
    user : string,
    fileName : string,
    language : string,
    code : string,
    extension : string,
    response : string | number,
    workerId : number
}

const jobGenerator = (user : string, jobId : string, filename : string, language : string, code : string, extension : string) => {
    const job : JOB_TYPE = new Job(jobId, user, filename, language, code, extension);
    return job;
}

const validBody = (req : Request, res : Response, next : NextFunction) => {
    if(!req.body || Object.keys(req.body).length === 0){
        res.status(400).json({ status: "error", message: "Missing body" });
        return;
    }
    next();
}

app.use(express.json())
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});
app.get("/status/:jobId", async (req : Request, res : Response) => {

    const jobId = req.params.jobId;
    const key = `result:${jobId}`;
    let job: string | null;
    try {
        job = await client.GET(key);
    } catch {
        console.error('Local Redis result lookup failed');
        const upstashJob = await getUpstashResult(key);
        if (upstashJob) {
            res.json({
                status: "pop-success",
                message: "Job Execution Successfull",
                data: JSON.parse(upstashJob)
            });
            return;
        }
        res.json({
            status: "pop-issue",
            message: "Unable to add the job on queue"
        });
        return;
    }

    if (!job) {
        job = await getUpstashResult(key);
    }
    if (!job) {
        res.json({
            status: "pending",
            message: "Your Job is under Construction"
        });
        return;
    }

    res.json({ 
        status : "pop-success",
        message: "Job Execution Successfull", 
        data : JSON.parse(job) 
    });
})

app.post("/set-job", validBody, async(req : Request, res : Response) => {
    
    const { user, filename, language, code, extension} = req.body;

    const jobId = v4();

    const userJob = jobGenerator(user, jobId, filename, language, code, extension)

    try{
        await client.LPUSH("pending", JSON.stringify(userJob));
    }
    catch(e){
        res.send(JSON.stringify({
            status : "push-issue",
            message : "Unable to add the job on queue"
        }))
        return;
    }

    // Upstash is a best-effort keyed mirror, not a second worker queue.
    void mirrorJobToUpstash(userJob);

    res.send(JSON.stringify({ 
        status : "push-success",
        message: "Job Queued", 
        jobId: jobId, 
        statusUrl: `/status/${jobId}` 
    }));
});


app.listen(3000, () => {
    console.log("Listening at port 3000")
})
