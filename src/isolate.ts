import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires
const Module = require('module');
// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires
const callsites = require('callsites');
const registeredMocks = new Map<string, {modulePath: string, mockReturnValue: any}>();

function debug(msg: any) {

    if (!process.env.ISOLATE_DEBUG) return;

    console.log('isolate debug:', msg);

}

Module.prototype.require = new Proxy(Module.prototype.require, {
    apply(target, thisArg, argumentsList) {

        const [name] = argumentsList;
        // eslint-disable-next-line no-underscore-dangle
        const absolutePath = Module._resolveFilename(name, thisArg);
        const mock = registeredMocks.get(absolutePath);

        debug(`require(): ${name} [${absolutePath}]`);

        if (mock) {

            debug(`require(): <!> REPLACING ${name} [${absolutePath}] WITH MOCK`);
            registeredMocks.delete(absolutePath);
            return mock.mockReturnValue;

        }

        return Reflect.apply(target, thisArg, argumentsList);

    },
});

function resolve(modulePath: string, dir: string, parentModule: any): string {

    debug(`resolve(): module: ${modulePath}, dir: ${dir}`);

    // if path starts with ., then it's relative
    if (modulePath.slice(0, 1) === '.') {

        const resolvedAbsPath = path.resolve(dir, modulePath);

        // eslint-disable-next-line no-underscore-dangle
        return Module._resolveFilename(resolvedAbsPath, parentModule);

    }

    // eslint-disable-next-line no-underscore-dangle
    return Module._resolveFilename(modulePath, parentModule);

}

function registerMockModules(mockModules: object, dir: string, parentModule: any) {

    Object.entries(mockModules).forEach((mockModule: any) => {

        const [modulePath, mockReturnValue] = mockModule;
        const absolutePath = resolve(modulePath, dir, parentModule);

        debug(`registerMocks(): ${modulePath} [${absolutePath}]`);

        if (!absolutePath) {

            throw new Error(`Unable to find module "${modulePath}".`);

        }

        registeredMocks.set(absolutePath, {
            modulePath,
            mockReturnValue,
        });

    });

}

export function isolate(modulePath: string, mocks: {
    imports?: object
    props?: object
}) {

    if (process.env.NODE_ENV === 'production') throw new Error('not for use in production');

    const callerFile = callsites()[1].getFileName() as string;
    const parentModule = module.parent?.parent;
    const dir = path.dirname(callerFile);
    const absolutePath = resolve(modulePath, dir, parentModule);
    const moduleDir = path.dirname(absolutePath);

    debug(`isolate(): ${modulePath} [${absolutePath}]`);
    debug(`isolate(): caller: ${callerFile}`);

    if (!absolutePath) {

        throw new Error(`Unable to find module "${modulePath}".`);

    }

    mocks.imports && registerMockModules(mocks.imports, moduleDir, parentModule);
    delete require.cache[absolutePath];

    // eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires
    const mod = require(absolutePath);

    // make sure there are no unused mocks
    if (registeredMocks.size) {

        throw new Error(`The following imports were not found in module ${modulePath}: 
        ${[...registeredMocks.values()].map((mock) => mock.modulePath).join(', ')}`);

    }

    mocks.props && mockProps(mod, mocks.props);

    // make sure this is not cached either, especially as it contains mocks that we don't want to keep around
    delete require.cache[absolutePath];

    return mod;

}

function mockProps(mod: any, mocks: [string, any][]) {

    // eslint-disable-next-line prefer-destructuring
    mocks.forEach((tuple) => mod[tuple[0]] = tuple[1]);

}
