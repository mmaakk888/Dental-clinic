type Transport=(route:string,input:RequestInit)=>Promise<Response>;
let transport:Transport|null=null;
export function configureAiTransport(value:Transport){transport=value;}
export function fetchAi(route:string,input:RequestInit):Promise<Response>{return transport?transport(route,input):fetch(route,input);}
