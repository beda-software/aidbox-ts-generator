import fetch from 'node-fetch';
import {
    InterfaceDeclarationStructure,
    Project,
    StructureKind,
    TypeAliasDeclarationStructure,
} from 'ts-morph';
import yargs from 'yargs';

import { Attribute, Entity, EntityWithAttributes } from './types';
import { capitalize, convertPathToCamelCase, preparePropertyName } from './utils';

const serverUrl = 'http://localhost:8080';

// TODO: pass server Url and auth header to argv
// TODO: Parametrize Bundle
// TODO: add type aliases for AidboxResource/AidboxReference

interface Argv {
    output: string;
    [x: string]: unknown;
}

const argv = yargs(process.argv.slice(2))
    .options({
        output: {
            description: 'Output file',
            alias: 'o',
            type: 'string',
            demandOption: true,
        },
    })
    .help()
    .alias('help', 'h').argv;

main(argv)
    .then(() => console.log('Aidbox type script annotations are successfully generated'))
    .catch((err) => console.log('Error while generating', err));

async function main(argv: Argv) {
    const project = new Project({});
    const annotationsFile = project.createSourceFile(argv.output, {}, { overwrite: true });

    const entitiesWithAttributes = await getEntitiesWithAttributes();
    const interfaceDeclarations: Record<string, InterfaceDeclarationStructure> = {};
    const typeAliasDeclarations: Record<string, TypeAliasDeclarationStructure> = {};

    // TODO: use type aliases for Reference/Resource
    interfaceDeclarations.AidboxResource = {
        kind: StructureKind.Interface,
        name: 'AidboxResource',
        isExported: true,
        properties: [
            { name: 'resourceType', type: 'string' },
            { name: 'id', type: 'id', hasQuestionToken: true },
            { name: 'meta', type: 'Meta', hasQuestionToken: true },
        ],
    };
    interfaceDeclarations.AidboxReference = {
        kind: StructureKind.Interface,
        name: 'AidboxReference<T extends AidboxResource>',
        isExported: true,
        properties: [
            { name: 'resourceType', type: `T['resourceType']` },
            { name: 'id', type: 'id' },
            { name: 'display', type: 'string', hasQuestionToken: true },
        ],
    };

    entitiesWithAttributes.forEach(({ entity }) => {
        if (entity.type === 'primitive') {
            fillTypeAliases(typeAliasDeclarations, entity);
        } else {
            fillInterfaces(interfaceDeclarations, entity);
        }
    });

    entitiesWithAttributes.forEach(({ entity, attributes }) => {
        if (entity.type !== 'primitive') {
            fillProperties(interfaceDeclarations, entity, attributes);
        }
    });

    annotationsFile.addTypeAliases(Object.values(typeAliasDeclarations));
    annotationsFile.addInterfaces(Object.values(interfaceDeclarations));

    await project.save();
}

async function getEntitiesWithAttributes(): Promise<EntityWithAttributes[]> {
    const doQuery = (url: string) => {
        return fetch(`${serverUrl}${url}`, {
            headers: {
                'Content-Type': 'application/json',
            },
        }).then((response: any) => response.json());
    };

    let url = `/Entity?_count=10&_sort=type,id&_revinclude=Attribute:entity`;
    const result: EntityWithAttributes[] = [];
    while (url) {
        const data = await doQuery(url);

        const resources: Array<Entity | Attribute> = data.entry.map((entry: any) => entry.resource);

        const entitiesWithAttributesList = Object.values(
            resources.reduce((acc, resource) => {
                if (resource.resourceType === 'Entity') {
                    if (!(resource.id in acc)) {
                        const entity = resource as Entity;

                        acc[entity.id] = {
                            entity,
                            attributes: [],
                        };
                    }
                } else {
                    const attr = resource as Attribute;

                    acc[attr.resource.id].attributes.push(attr);
                }

                return acc;
            }, {} as Record<string, EntityWithAttributes>),
        );

        result.push.apply(result, entitiesWithAttributesList);

        url = data.link.find((link: { relation: string; url: string }) => link.relation === 'next')
            ?.url;
    }

    return result
        .map(({ entity, attributes }) => ({
            entity,
            attributes: attributes.sort((attribute1: Attribute, attribute2: Attribute) => {
                if (attribute1.path.length === attribute2.path.length) {
                    return attribute1.path.join('_').localeCompare(attribute2.path.join('_'));
                }

                return attribute2.path.length - attribute1.path.length;
            }),
        }))
        .sort((a, b) => a.entity.id.localeCompare(b.entity.id));
}

function fillTypeAliases(
    typeAliasDeclarations: Record<string, TypeAliasDeclarationStructure>,
    entity: Entity,
) {
    if (['string', 'boolean', 'number'].includes(entity.id)) {
        return;
    }

    typeAliasDeclarations[entity.id] = {
        kind: StructureKind.TypeAlias,
        name: entity.id,
        isExported: true,
        type: ['unsignedInt', 'positiveInt', 'integer', 'decimal'].includes(entity.id)
            ? 'number'
            : 'string',
    };
}

function fillInterfaces(
    interfaceDeclarations: Record<string, InterfaceDeclarationStructure>,
    entity: Entity,
) {
    const interfaceName = entity.id;

    if (interfaceName === 'Reference' || interfaceName === 'Resource') {
        interfaceDeclarations[interfaceName] = {
            docs: entity.description ? [entity.description] : undefined,
            kind: StructureKind.Interface,
            isExported: true,
            name: interfaceName,
            properties: [],
        };
    } else {
        interfaceDeclarations[interfaceName] = {
            docs: entity.description ? [entity.description] : undefined,
            kind: StructureKind.Interface,
            isExported: true,
            name:
                interfaceName === 'Bundle'
                    ? `${interfaceName}<T extends AidboxResource>`
                    : interfaceName,
            properties: [
                { name: 'readonly resourceType', type: `'${interfaceName}'` },
                { name: 'id', type: 'id', hasQuestionToken: true },
                { name: 'meta', type: 'Meta', hasQuestionToken: true },
            ],
        };
    }
}

function fillProperties(
    interfaceDeclarations: Record<string, InterfaceDeclarationStructure>,
    entity: Entity,
    attributes: Attribute[],
) {
    const resourceType = entity.id;

    attributes.forEach((attribute) => {
        if (attribute.path[attribute.path.length - 1] === '*') {
            return;
        }

        if (
            entity.id !== 'Reference' &&
            entity.id !== 'Resource' &&
            attribute.path.length === 1 &&
            (attribute.path[0] === 'id' || attribute.path[0] === 'meta')
        ) {
            // Skip id because every resource has this field, but aidbox doesn't return it for custom resources
            return;
        }

        const prepareInterfaceName = (path: string[]) => {
            return capitalize(
                convertPathToCamelCase([
                    resourceType,
                    ...path
                        .filter((p) => p !== '*')
                        .slice(0, path.filter((p) => p !== '*').length - 1),
                ]),
            );
        };

        const interfaceName = prepareInterfaceName(attribute.path);

        const propertyName = preparePropertyName(
            attribute.path.filter((p) => p !== '*')[
                attribute.path.filter((p) => p !== '*').length - 1
            ],
        );

        const interfaceDeclaration = interfaceDeclarations[interfaceName];

        const getPropertyType = () => {
            if (attribute.enum) {
                return attribute.enum.map((v) => `'${v}'`).join(' | ');
            }

            const propertyInterfaceType = capitalize(
                convertPathToCamelCase([resourceType, ...attribute.path.filter((p) => p !== '*')]),
            );

            if (interfaceDeclarations[propertyInterfaceType]) {
                return propertyInterfaceType;
            }

            if (attribute.type) {
                if (attribute.type.id === 'Map') {
                    if (interfaceDeclarations[propertyInterfaceType]) {
                        return `Record<string, ${propertyInterfaceType}>`;
                    } else {
                        return 'Record<string, any>';
                    }
                }

                // Recursive
                const attrById = attributes.find((attr) => attr.id === attribute.type.id);
                if (attrById) {
                    return convertPathToCamelCase([
                        resourceType,
                        ...attrById.path.filter((p) => p !== '*'),
                    ]);
                }

                // TODO: generalize
                if (attribute.type.id === 'BundleEntry') {
                    return 'BundleEntry<T>';
                }

                // TODO: generalize
                if (entity.id === 'Bundle' && attribute.path.join('.') === 'entry.resource') {
                    return 'T';
                }

                return attribute.type.id;
            }

            return 'any';
        };

        const getDocs = () => {
            if (attribute.description) {
                return [attribute.description];
            }

            if (entity._source === 'code' && attribute._source !== 'code') {
                return ['NOTE: from extension'];
            }
            return;
        };
        const property = {
            docs: getDocs(),
            type: `${getPropertyType()}${attribute.isCollection ? '[]' : ''}`,
            name: propertyName,
            hasQuestionToken: !attribute.isRequired,
        };

        if (interfaceDeclaration) {
            // Resource interface
            // Properties are always defined even if empty
            interfaceDeclaration.properties!.push(property);
        } else {
            // Auxiliary interface
            interfaceDeclarations[interfaceName] = {
                kind: StructureKind.Interface,
                isExported: true,
                name: interfaceName === 'BundleEntry' ? `${interfaceName}<T>` : interfaceName,
                properties: [property],
            };
        }
    }, {});
}
