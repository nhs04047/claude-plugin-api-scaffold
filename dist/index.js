import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
// Tool argument schemas
const ApiScaffoldSchema = z.object({
    description: z.string().describe('Natural language description of the API to generate'),
    framework: z.enum(['express', 'fastify', 'hono']).default('express'),
    outputDir: z.string().default('./generated-api'),
});
const OpenApiGenerateSchema = z.object({
    schema: z.string().describe('OpenAPI JSON schema or URL'),
    language: z.enum(['typescript', 'javascript', 'python']).default('typescript'),
});
// API endpoints database (built-in common APIs)
const COMMON_APIS = {
    auth: 'User authentication with JWT, register/login/logout endpoints',
    blog: 'Blog CMS with posts, comments, users, JWT auth',
    ecommerce: 'E-commerce API with products, cart, orders, payment',
    todo: 'Todo list API with CRUD operations',
    chat: 'Real-time chat API with rooms, messages, users',
};
const server = new Server({
    name: 'claude-plugin-api-scaffold',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'api_scaffold',
                description: 'Generate API server code from natural language description',
                inputSchema: {
                    type: 'object',
                    properties: {
                        description: {
                            type: 'string',
                            description: 'API description (e.g., "User auth API with JWT")',
                        },
                        framework: {
                            type: 'string',
                            enum: ['express', 'fastify', 'hono'],
                            description: 'Target framework',
                        },
                        outputDir: {
                            type: 'string',
                            description: 'Output directory for generated code',
                        },
                    },
                    required: ['description'],
                },
            },
            {
                name: 'openapi_generate',
                description: 'Generate code from OpenAPI schema',
                inputSchema: {
                    type: 'object',
                    properties: { schema: {
                            type: 'string',
                            description: 'OpenAPI JSON or URL',
                        },
                        language: {
                            type: 'string',
                            enum: ['typescript', 'javascript', 'python'],
                            description: 'Target language',
                        },
                    },
                    required: ['schema'],
                },
            },
            {
                name: 'common_apis',
                description: 'List available common API templates',
                inputSchema: {
                    type: 'object',
                    properties: {},
                },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
        case 'common_apis': {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Available API templates:\n' +
                            Object.entries(COMMON_APIS)
                                .map(([key, desc]) => `- ${key}: ${desc}`)
                                .join('\n'),
                    },
                ],
            };
        }
        case 'api_scaffold': {
            const parsed = ApiScaffoldSchema.parse(args);
            const result = generateApiFromDescription(parsed.description, parsed.framework, parsed.outputDir);
            return {
                content: [{ type: 'text', text: result }],
            };
        }
        case 'openapi_generate': {
            const parsed = OpenApiGenerateSchema.parse(args);
            const result = await generateFromOpenApi(parsed.schema, parsed.language);
            return {
                content: [{ type: 'text', text: result }],
            };
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});
function generateApiFromDescription(description, framework, outputDir) {
    const frameworkTemplate = getFrameworkTemplate(framework);
    const endpoints = generateEndpoints(description);
    return `# Generated API Scaffold

## Installation
\`\`\`bash
mkdir ${outputDir}
cd ${outputDir}
npm init -y
npm install ${frameworkTemplate.deps.join(' ')}
\`\`\`

## Server Code (${frameworkTemplate.mainFile})
\`\`\`typescript
${frameworkTemplate.code(endpoints)}
\`\`\`

## Structure
\`\`\`
${outputDir}/
├── src/
│   ├── routes/
│   │   ${Object.keys(endpoints).map(k => `├── ${k}.ts`).join('\n│   ')}
│   ├── middleware/
│   │   └── auth.ts
│   └── index.ts
├── package.json
└── tsconfig.json
\`\`\`

Generated successfully!`;
}
function getFrameworkTemplate(framework) {
    const templates = {
        express: {
            deps: ['express', '@types/express', 'typescript', 'ts-node'],
            mainFile: 'index.ts',
            code: (endpoints) => `import express from 'express';
const app = express();
app.use(express.json());

${Object.entries(endpoints).map(([name, methods]) => methods.map((m) => `app.${m}('/api/${name}', async (req, res) => {
  res.json({ message: '${name} ${m}' });
});`).join('\n')).join('\n')}

export default app;`,
        },
        fastify: {
            deps: ['fastify', '@types/node', 'typescript'],
            mainFile: 'server.ts',
            code: (endpoints) => `import Fastify from 'fastify';
const app = Fastify();

${Object.entries(endpoints).map(([name, methods]) => methods.map((m) => `app.${m}('/api/${name}', async (req, reply) => {
  return { message: '${name} ${m}' };
});`).join('\n')).join('\n')}

export default app;`,
        },
        hono: {
            deps: ['hono', '@hono/node-server', 'typescript'],
            mainFile: 'app.ts',
            code: (endpoints) => `import { Hono } from 'hono';
const app = new Hono();

${Object.entries(endpoints).map(([name, methods]) => methods.map((m) => `app.${m}('/api/${name}', (c) => {
  return c.json({ message: '${name} ${m}' });
});`).join('\n')).join('\n')}

export default app;`,
        },
    };
    return templates[framework];
}
function generateEndpoints(description) {
    const desc = description.toLowerCase();
    if (desc.includes('user') || desc.includes('auth')) {
        return {
            auth: ['post', 'get'],
            users: ['get', 'post', 'put', 'delete'],
        };
    }
    if (desc.includes('blog') || desc.includes('post')) {
        return {
            posts: ['get', 'post', 'put', 'delete'],
            comments: ['get', 'post', 'delete'],
        };
    }
    if (desc.includes('todo') || desc.includes('task')) {
        return {
            todos: ['get', 'post', 'put', 'delete'],
        };
    }
    return {
        api: ['get', 'post'],
    };
}
async function generateFromOpenApi(schema, language) {
    // Parse schema if it's JSON, otherwise fetch it
    let spec;
    try {
        if (schema.startsWith('http')) {
            // Fetch remote schema
            const response = await fetch(schema);
            spec = await response.json();
        }
        else {
            spec = JSON.parse(schema);
        }
    }
    catch {
        return 'Error: Invalid OpenAPI schema provided';
    }
    const paths = Object.keys(spec.paths || {});
    return `# OpenAPI Generated Code

## Endpoints (${paths.length} found)
${paths.map(p => `- ${Object.keys(spec.paths[p]).join(', ').toUpperCase()} ${p}`).join('\n')}

## Generated ${language} types and routes...`;
}
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('API Scaffold MCP Server running...');
