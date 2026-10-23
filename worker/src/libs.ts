import path from "path";

export const EXTENSIONS = {
  "java": "java",
  "javascript": "js",
  "typescript": "ts",
  "python": "py",
  "rust": "rs", 
};

export const getExecutionCommand = (lang: string, filePath: string, baseName: string, jobDir: string) => {
  switch (lang) {
    case "java":
      return `javac ${filePath} && java -cp ${jobDir} ${baseName}`;
    
    case "js":
      return `node ${filePath}`;
    
    case "ts":
      return `tsc ${filePath} --outDir ${jobDir} --module esnext --target esnext --moduleResolution node && node ${path.join(jobDir, baseName + '.js')}`;
    
    case "py":
      return `python3 ${filePath}`;
    
    case "rs":
      const binaryPath = path.join(jobDir, baseName);
      return `rustc ${filePath} -o ${binaryPath} && ${binaryPath}`;
    
    default:
      throw new Error(`Unsupported language extension: ${lang}`);
  }
};