export class Job{
    
    public jobId : string;
    public user : string;
    public fileName : string;
    public language : string;
    public code : string;
    public extension : string;
    public response : string | number;
    public workerId : number;

    constructor(jobId : string, user : string, fileName : string, language : string, code : string, extension : string){
        this.jobId = jobId
        this.user = user;
        this.fileName = fileName;
        this.language = language;
        this.code = code;
        this.extension = extension;
        this.response = "";
        this.workerId = 0;
    }
}