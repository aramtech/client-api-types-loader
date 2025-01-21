#!/usr/bin/env bun
const axios = (await import("axios")).default;
const unzipper = await import("unzipper");
import { program } from "commander";
// @ts-ignore
import fs from "fs";
import path from "path";
import url from "url";

// @ts-ignore
const __process = process;

const currentDir = (() => {
    try {
        return url.fileURLToPath(new url.URL("./.", import.meta.url));
    } catch (error) {
        // @ts-ignore
        return __dirname;
    }
})();
const utilsConfig: typeof import("./utils.json") = JSON.parse(
    fs.readFileSync(path.join(currentDir, "./utils.json"), "utf-8")
);

const parentProjectPath = path.join(currentDir, "../.");
const findProjectRoot = async (currentDir = parentProjectPath): Promise<string> => {
    const packagePath = path.join(currentDir, "package.json");

    if (fs.existsSync(packagePath)) {
        return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
        console.error("No package.json file found in any parent directory.");
        __process.exit(1);
    }

    return findProjectRoot(parentDir);
};
const projectRoot = await findProjectRoot();
const packageDotJsonFullPath = path.join(projectRoot, "./package.json");
const packageDotJson: {
    [key: string]: any;
    "api-types"?: {
        "api-prefix": string;
        "assets-prefix": string;
        baseUrl: string;
        scope?: string;
        apiClientPath: string;
        secret: string;
    };
} = JSON.parse(fs.readFileSync(packageDotJsonFullPath, "utf-8"));

if (!packageDotJson["api-types"]) {
    console.error(
        "Please provide api types loading config in package.json before loading api types as in ",
        `{
        "api-prefix": string;
        "assets-prefix": string;
        "baseUrl": string; 
        scope?: string;
        "secret": string;  
    }`
    );
    __process.exit(1);
}
const api_types_file_path = path.join(projectRoot, packageDotJson["api-types"]?.apiClientPath as string);

program
    .name("api_types_loader")
    .description("set of commands to control autocomplete and type system on API of axios.")
    .version(utilsConfig.version);

const trim_slashes = (s: string) => {
    return s.replace(/\/$/, "").replace(/^\//, "");
};
const join = (...paths: string[]) => {
    return paths.map((s) => trim_slashes(s)).join("/");
};

const extract_api_error = (error: any) => {
    error.message =
        error.response?.data?.err?.msg ||
        error.response?.data?.err?.message ||
        error.response?.data?.error?.msg ||
        error.response?.data?.error?.message ||
        error.response?.data?.error?.name ||
        error.response?.data?.msg ||
        error.response?.data?.message ||
        error.response?.data?.name ||
        error.msg ||
        error.message ||
        error.name;
};

interface DynamicAuthorities {
    values?: Array<string | number>;
    request_lookup_cb?: string;
    dynamic_authority_key?: string;
}

interface Authority {
    key_name: string;
    dynamic_authorities?: { [key: string]: DynamicAuthorities };
}

type ArrayAuthorities = Array<Authority>;

interface AuthorizationOption {
    or?: ArrayAuthorities | Array<string>;
    and?: ArrayAuthorities | Array<string>;
}

export type ChannelsDescriptionProps = {
    fileUrl: string;
    path?: string;
    full_channel_path?: string;
    requires_auth?: boolean;
    requires_authorities?: {
        allow?: AuthorizationOption;
        reject?: AuthorizationOption;
    };
    description_text?: string;
    request_body_type_string?: string;
    additionalTypes?: string;
    response_body_type_string?: string;
    description_file_full_path?: string;
};

type DescriptionProps = {
    fileUrl: string;
    path?: string;
    additionalTypes?: string;
    full_route_path?: string;
    requires_auth?: boolean;
    requires_authorities?: string[];
    description_text?: string;
    method: "all" | "get" | "put" | "post" | "delete";
    request_params_type_string?: string;
    request_body_type_string?: string;
    request_headers_type_string?: string;
    response_content_type?: string;
    response_body_type_string?: string;
    description_file_full_path?: string;
};


export type EventDescriptionProps = {
    fileUrl: string;
    event: string;
    rooms?: string[];
    description_text?: string;
    event_body_type_string: string;
    additionalTypes?: string;
    expected_response_body_type_string?: string;
    description_file_full_path?: string;
};

program
    .command("load_types")
    .alias("l")
    .option("-s", "--scope <SCOPE>")
    .option("--api_prefix <API_PREFIX>")
    .option("--assets_prefix <ASSETS_PREFIX>")
    .option("-b", "--base_url <BASEURL>")
    .description("use it to load api types from server")
    .action(async ({ scope, api_prefix, assets_prefix, base_url }: { [key: string]: string }) => {
        if (!packageDotJson["api-types"]) {
            console.error(
                "Please provide api types loading config in package.json before loading api types as in ",
                `{
                "api-prefix": string;
                "assets-prefix": string;
                "baseUrl": string; 
                scope?: string;
                "secret": string;  
            }`
            );
            __process.exit(1);
        }

        const apiTypesDirFullPath = path.join(projectRoot, "/api-types");
        fs.mkdirSync(apiTypesDirFullPath, { recursive: true });
        const client_archive_full_path = path.join(apiTypesDirFullPath, "client.zip");

        if (!scope) {
            if (!packageDotJson["api-types"]?.scope) {
                console.error("please provide valid scope in package.json apy-types");
                __process.exit(1);
                return;
            }
            scope = packageDotJson["api-types"]?.scope;
        }

        if (!base_url && packageDotJson["api-types"]?.baseUrl) {
            base_url = packageDotJson["api-types"]?.baseUrl;
        }

        if (!api_prefix && packageDotJson["api-types"]?.["api-prefix"]) {
            api_prefix = packageDotJson["api-types"]?.["api-prefix"];
        }
        api_prefix = join(base_url, api_prefix);

        if (!assets_prefix && packageDotJson["api-types"]?.["assets-prefix"]) {
            assets_prefix = packageDotJson["api-types"]?.["assets-prefix"];
        }
        assets_prefix = join(base_url, assets_prefix);

        const secret = packageDotJson["api-types"]?.secret;

        const load_prisma_client = () => {
            return new Promise(async (resolve, reject) => {
                try {
                    console.log("Loading Client");
                    const response = await axios({
                        data: {
                            secret: secret,
                        },
                        method: "post",
                        url: join(`${api_prefix}`, `/api_description/prisma_compressed_client`),
                        responseType: "stream",
                    });

                    console.log("downloading prisma client...");
                    const stream = response.data;

                    const file_write_stream = fs.createWriteStream(client_archive_full_path);

                    stream.pipe(file_write_stream);
                    stream.on("error", (error) => {
                        console.log(error);
                        reject(error);
                    });

                    file_write_stream.on("finish", () => {
                        console.log("finished downloading client\n\nExtracting Client...");
                        fs.createReadStream(client_archive_full_path)
                            .pipe(unzipper.Extract({ path: apiTypesDirFullPath }))
                            .on("finish", () => {
                                console.log("Client Extraction complete");
                                resolve(true);
                            })

                            .on("error", (err) => {
                                if (err.message == "FILE_ENDED") {
                                } else {
                                    console.error("Error during extraction:", err.message);
                                    reject(err);
                                }
                            });
                    });
                } catch (error) {
                    reject(error);
                }
            });
        };

        const build_types = async () => {
            console.log("Building Types");

            const api_description: { [key: string]: DescriptionProps } = (
                await axios({
                    method: "get",
                    url: join(assets_prefix, `/api_description_map.json`),
                })
            ).data;

            const channels_description: { [key: string]: ChannelsDescriptionProps } = (
                await axios({
                    method: "get",
                    url: join(assets_prefix, `/channels_description_map.json`),
                })
            ).data;



            const events_description: { [key: string]: EventDescriptionProps } = (
                await axios({
                    method: "get",
                    url: join(assets_prefix, `/events_description_map.json`),
                })
            ).data;

            const content = [
                `// @ts-nocheck
import { $Enums, Prisma } from "${path.relative(
                    path.dirname(api_types_file_path),
                    apiTypesDirFullPath
                )}/client/index.js";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { Merge } from "../common";



export type AsyncEmitOptions = {
    timeout?: number;
    sinceMins?: number;
    now?: boolean;
    quiet?: boolean;
    notScoped?: boolean;
};

export type RequestConfig<D> = {
    sinceMins?: number;
    now?: boolean;
    request_via?: ("http"|"socket")[]
    quiet?: boolean;
} & AxiosRequestConfig<D>;


type OmitFunctions<T> = T extends any[]? T: Pick<T, {
  [K in keyof T]: T[K] extends Function ? never : K
}[keyof T]>;

        `,
            ];

            console.log(
                `\n\n################################ Looking for Scope "${scope}" ################################`
            );

            const routes_array = Object.values(api_description).filter((r) => {
                const result = trim_slashes(r.full_route_path || "")?.startsWith(trim_slashes(scope));
                console.log(r.full_route_path, result);
                return result;
            });

            const channels_array = Object.values(channels_description).filter((c) => {
                const result = trim_slashes(c.full_channel_path || "")?.startsWith(trim_slashes(scope));
                console.log(c.full_channel_path, result);
                return result;
            });

            const events_array = Object.values(events_description)

            console.log(
                "###########################################################################################\n\n\n"
            );

            for (const r of routes_array) {
                for (const key in r) {
                    if (key.endsWith("type_string")) {
                        r[key] = r[key]?.replace(/;$/, "");
                        r[key] = `OmitFunctions<${r[key]}>`;
                    }
                }
                r.full_route_path = trim_slashes(r.full_route_path || "")?.slice(trim_slashes(scope).length);
            }

            for (const c of channels_array) {
                for (const key in c) {
                    if (key.endsWith("type_string")) {
                        c[key] = c[key]?.replace(/;$/, "");
                        c[key] = `OmitFunctions<${c[key]}>`;
                    }
                }
                c.full_channel_path = trim_slashes(c.full_channel_path || "")?.slice(trim_slashes(scope).length);
            }


            for (const e of events_array) {
                for (const key in e) {
                    if (key.endsWith("type_string")) {
                        e[key] = e[key]?.replace(/;$/, "");
                        e[key] = `OmitFunctions<${e[key]}>`;
                    }
                }
            }

            content.push(`

${channels_array
    .map((c) => {
        return c.additionalTypes;
    })
    .filter((e) => !!e)
    .join("\n\n")}

${routes_array
    .map((c) => {
        return c.additionalTypes;
    })
    .filter((e) => !!e)
    .join("\n\n")}    


${events_array
    .map((c) => {
        return c.additionalTypes;
    })
    .filter((e) => !!e)
    .join("\n\n")}    
    
        


`);



            if (!events_array.length) {
                content.push(`
export type OnEvent = (
    event: string,
    cb: (body: any, cb?: (body?: any) => Promise<void>) => any | Promise<any>
) => Promise<() => void>;

        `);
            } else {
                content.push(`


export type OnEventNames = ${events_array.map((c) => `"${c.event}"`).join(" | ")};

export type OnEventBody<U extends string> = ${events_array
                    .map((r) => {
                        return `
U extends "${r.event}"
? ${r.event_body_type_string}
:`;
                    })
                    .join("")} any;

export type OnEventExpectedResponse<U extends string> = ${events_array
                    .map((r) => {
                        return `
U extends "${r.event}"
? ${r.expected_response_body_type_string}
:`;
                    })
                    .join("")} undefined;


export type OnEventBodyMap = {${events_array
                    .map((r) => {
                        return `
"${r.event}": ${r.event_body_type_string};`;
                    })
                    .join("")}
};

export type OnEvent = <U extends AsyncEmitEvents | string>(
    event: U,
    cb: (
            body: OnEventBody<U>,  
            cb: OnEventExpectedResponse<U> extends never ? never : OnEventExpectedResponse<U> extends undefined ? (((body?: any) => Promise<void>) | undefined) : ((body?: OnEventExpectedResponse<U>) => Promise<void>)
        ) => any | Promise<any>
) => Promise<() => void>;

`);
            }

            //!!
            //!!
            //!!

            if (!channels_array.length) {
                content.push(`
export type AsyncEmit = <T = any>(event: string, body?: any, options?: AsyncEmitOptions) => Promise<T>;
                    `);
            } else {
                content.push(`
    
export type AsyncEmitEvents = ${channels_array.map((c) => `"${c.full_channel_path}"`).join(" | ")};

export type AsyncEmitBody<U extends string> = ${channels_array
                    .map((r) => {
                        return `
    U extends "${r.full_channel_path}"
    ? ${r.request_body_type_string}
    :`;
                    })
                    .join("")} any;

export type AsyncEmitResponse<U extends string> = ${channels_array
                    .map((r) => {
                        return `
U extends "${r.full_channel_path}"
? ${r.response_body_type_string}
:`;
                    })
                    .join("")} any;


export type AsyncEmitResponseMap = {${channels_array
                    .map((r) => {
                        return `
"${r.full_channel_path}": ${r.response_body_type_string};`;
                    })
                    .join("")}
};

export type AsyncEmit = <U extends AsyncEmitEvents | string>(
    url: U,
    body?: AsyncEmitBody<U>,
    config?: AsyncEmitOptions,
) => Promise<AsyncEmitResponse<U>>;
                    
    `);
            }

            //!!
            //!!
            //!!

            const post_routes = routes_array.filter((r) => {
                return r.method == "post" || r.method == "all";
            });
            if (!post_routes.length) {
                content.push(`

export type ApiPost = <T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: D,
    config?: AsyncEmitOptions & RequestConfig<D>
) => Promise<R>;

            `);
            } else {
                content.push(`

export type ApiPostUrl = ${post_routes.map((r) => `"${r.full_route_path}"`).join(" | ")};

export type ApiPostBody<U extends string> = ${post_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_body_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiPostResponse<U extends string> = ${post_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.response_body_type_string}
    :`;
                    })
                    .join("")} any;

export type ApiPostResponseMap = {${post_routes
                    .map((r) => {
                        return `
    "${r.full_route_path}": ${r.response_body_type_string};`;
                    })
                    .join("")}
};
export type ApiPostResponseExtractor<Url extends keyof ApiPostResponseMap> = ApiPostResponseMap[Url]



export type ApiPostHeaders<U extends string> = ${post_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_headers_type_string} & {
        [key: string]: string; 
    } :`;
                    })
                    .join("")} any;


export type ApiPostParams<U extends string> = ${post_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_params_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiPost = <U extends ApiPostUrl | string>(
    url: U,
    data?: ApiPostBody<U>,
    config?: AsyncEmitOptions &  Merge<{
        ${
            post_routes.some((r) => r.request_headers_type_string != "OmitFunctions<any>")
                ? "headers?: ApiPostHeaders<U>; "
                : ""
        }
        params?: ApiPostParams<U>; 
    }, RequestConfig<ApiPostBody<U>>>
) => Promise<AxiosResponse<ApiPostResponse<U>>>;


            `);
            }

            //
            //
            //

            const put_routes = routes_array.filter((r) => {
                return r.method == "put" || r.method == "all";
            });
            if (!put_routes.length) {
                content.push(`

export type ApiPut = <T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: D,
    config?: AsyncEmitOptions & RequestConfig<D>
) => Promise<R>;

            `);
            } else {
                content.push(`


export type ApiPutUrl = ${put_routes.map((r) => `"${r.full_route_path}"`).join(" | ")};

export type ApiPutBody<U extends string> = ${put_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_body_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiPutResponse<U extends string> = ${put_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.response_body_type_string}
    :`;
                    })
                    .join("")} any;



export type ApiPutHeaders<U extends string> = ${put_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_headers_type_string} & {
        [key: string]: string; 
    } :`;
                    })
                    .join("")} any;


export type ApiPutParams<U extends string> = ${put_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_params_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiPut = <U extends ApiPutUrl | string>(
    url: U,
    data?: ApiPutBody<U>,
    config?: AsyncEmitOptions & Merge<{
        ${
            put_routes.some((r) => r.request_headers_type_string != "OmitFunctions<any>")
                ? "headers?: ApiPutHeaders<U>; "
                : ""
        }
        params?: ApiPutParams<U>; 
    }, RequestConfig<ApiPutBody<U>>>
) => Promise<AxiosResponse<ApiPutResponse<U>>>;

            `);
            }

            //
            //
            //

            const get_routes = routes_array.filter((r) => {
                return r.method == "get" || r.method == "all";
            });
            if (!get_routes.length) {
                content.push(`

export type ApiGet = <T = any, R = AxiosResponse<T>, D = any>(url: string, config?: AsyncEmitOptions & RequestConfig<D>) => Promise<R>;;

            `);
            } else {
                content.push(`

         

export type ApiGetUrl = ${get_routes.map((r) => `"${r.full_route_path}"`).join(" | ")};

export type ApiGetBody<U extends string> = ${get_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_body_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiGetResponse<U extends string> = ${get_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.response_body_type_string}
    :`;
                    })
                    .join("")} any;



export type ApiGetHeaders<U extends string> = ${get_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_headers_type_string} & {
        [key: string]: string; 
    } :`;
                    })
                    .join("")} any;


export type ApiGetParams<U extends string> = ${get_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_params_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiGet = <U extends ApiGetUrl | string>(
    url: U,
    config?: AsyncEmitOptions & Merge<{
        ${
            get_routes.some((r) => r.request_headers_type_string != "OmitFunctions<any>")
                ? "headers?: ApiGetHeaders<U>; "
                : ""
        }
        params?: ApiGetParams<U>; 
    }, RequestConfig<ApiGetBody<U>>>
) => Promise<AxiosResponse<ApiGetResponse<U>>>;

            `);
            }

            //
            //
            //

            const delete_routes = routes_array.filter((r) => {
                return r.method == "delete" || r.method == "all";
            });
            if (!delete_routes.length) {
                content.push(`

export type ApiDelete = <T = any, R = AxiosResponse<T>, D = any>(url: string, config?: AsyncEmitOptions & RequestConfig<D>) => Promise<R>;;

            `);
            } else {
                content.push(`
         
export type ApiDeleteUrl = ${delete_routes.map((r) => `"${r.full_route_path}"`).join(" | ")};

export type ApiDeleteBody<U extends string> = ${delete_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_body_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiDeleteResponse<U extends string> = ${delete_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.response_body_type_string}
    :`;
                    })
                    .join("")} any;



export type ApiDeleteHeaders<U extends string> = ${delete_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_headers_type_string} & {
        [key: string]: string; 
    } :`;
                    })
                    .join("")} any;


export type ApiDeleteParams<U extends string> = ${delete_routes
                    .map((r) => {
                        return `
    U extends "${r.full_route_path}"
    ? ${r.request_params_type_string}
    :`;
                    })
                    .join("")} any;


export type ApiDelete = <U extends ApiDeleteUrl | string>(
    url: U,
    config?: AsyncEmitOptions & Merge<{
        ${
            delete_routes.some((r) => r.request_headers_type_string != "OmitFunctions<any>")
                ? "headers?: ApiDeleteHeaders<U>; "
                : ""
        }
        params?: ApiDeleteParams<U>; 
    }, RequestConfig<ApiDeleteBody<U>>>
) => Promise<AxiosResponse<ApiDeleteResponse<U>>>;

            `);
            }

            console.log("Writing Types....");
            fs.writeFileSync(api_types_file_path, content.join("\n"));
        };

        try {
            await load_prisma_client();
            await build_types();
        } catch (error: any) {
            extract_api_error(error);
            console.log(error?.message);
        }

        console.log("\n\nDone!!");
    });

program
    .command("reset_types")
    .alias("r")
    .description("reset types to be `any`")
    .action(async () => {
        fs.writeFileSync(
            api_types_file_path,
            `
        
import { AxiosRequestConfig, AxiosResponse } from "axios";

export type RequestConfig<D> = {
    sinceMins?: number;
    now?: boolean;
    request_via?: ("http"|"socket")[]
    quiet?: boolean;
} & AxiosRequestConfig<D>;

export type ApiPost = <T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: D,
    config?: AsyncEmitOptions & RequestConfig<D>
) => Promise<R>;

export type ApiPut = <T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: D,
    config?: AsyncEmitOptions & RequestConfig<D>
) => Promise<R>;
export type ApiDelete = <T = any, R = AxiosResponse<T>, D = any>(url: string, config?: AsyncEmitOptions & RequestConfig<D>) => Promise<R>;
export type ApiGet = <T = any, R = AxiosResponse<T>, D = any>(url: string, config?: AsyncEmitOptions & RequestConfig<D>) => Promise<R>;

export type AsyncEmitOptions = {
    timeout?: number;
    sinceMins?: number;
    now?: boolean;
    quiet?: boolean;
    notScoped?: boolean;
};

        `
        );
    });
program.parse();

export { };

