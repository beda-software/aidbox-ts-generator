import fs from 'fs';

import { compile } from 'json-schema-to-typescript';
import fetch, { Headers } from 'node-fetch';
import {
    InterfaceDeclarationStructure,
    Project,
    StructureKind,
    TypeAliasDeclarationStructure,
} from 'ts-morph';
import yargs from 'yargs';

import { Attribute, Entity, EntityWithAttributes } from './types';
import { capitalize, convertPathToCamelCase, preparePropertyName } from './utils';


// TODO: Parametrize Bundle

const argv = yargs(process.argv.slice(2))
    .options({
        outputFile: {
            description: 'Output file',
            alias: 'o',
            type: 'string',
            demandOption: true,
        },
        baseUrl: {
            description: 'Aidbox URL',
            alias: 'u',
            type: 'string',
            demandOption: true,
        },
        authorizationHeader: {
            description: 'Authorization header',
            alias: 'auth',
            type: 'string',
        },
        username: {
            description: 'Username for Basic auth',
            alias: 'user',
            type: 'string'
        },
        password: {
            description: 'Password for Basic auth',
            alias: 'pass',
            type: 'string',
        },
    })
    .help()
    .alias('help', 'h').argv;

const { authorizationHeader, baseUrl, outputFile, username, password } = argv;

main()
    .then(() => console.log('Aidbox type script annotations are successfully generated'))
    .catch((err) => console.log('Error while generating', err));

function getAuthHeaders() {
    if (authorizationHeader) {
        return { Authorization: authorizationHeader };
    }

    if (username &&password ){
        return { Authorization:'Basic ' + Buffer.from(username + ":" + password).toString('base64')}
    }

    return {};
}

function fetchResources<T extends { resourceType: string }>(
    resourceType: T['resourceType'],
): Promise<T[]> {
    return fetch(`${baseUrl}/${resourceType}/$dump`, {
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders() as Headers,
        },
    })
        .then((response: any) => response.text())
        .then((data) => data.trim().split('\n').map(JSON.parse));
}

async function main() {
    const project = new Project({});
    const annotationsFile = project.createSourceFile(outputFile, {}, { overwrite: true });

    const entitiesWithAttributes = await getEntitiesWithAttributes();
    const interfaceDeclarations: Record<string, InterfaceDeclarationStructure> = {};
    const typeAliasDeclarations: Record<string, TypeAliasDeclarationStructure> = {};
    const schemaInterfaces: Record<string, string> = {};

    typeAliasDeclarations.AidboxResource = {
        kind: StructureKind.TypeAlias,
        name: 'AidboxResource',
        isExported: true,
        type: 'Resource',
    };
    typeAliasDeclarations.AidboxReference = {
        kind: StructureKind.TypeAlias,
        name: 'AidboxReference<T extends Resource=any>',
        isExported: true,
        type: `Omit<Reference<T>, 'id'> & { id: keyword; }`,
    };


    entitiesWithAttributes.forEach(({ entity, attributes }) => {
        const resourceType = entity.id;

        attributes.forEach(async (attribute) => {
            if (attribute.schema) {
                const propertyInterfaceType = capitalize(
                    convertPathToCamelCase([resourceType, ...attribute.path.filter((p) => p !== '*')]),
                );

                try {
                    schemaInterfaces[propertyInterfaceType] = await compile(attribute.schema, propertyInterfaceType);
                } catch (err) {
                    console.warn(`Error while generating type declarations from JSON schema for ${propertyInterfaceType}`)
                }
            }
        })
    })

    entitiesWithAttributes.forEach(({ entity }) => {
        if (entity.type === 'primitive') {
            fillTypeAliases(typeAliasDeclarations, entity);
        } else {
            fillInterfaces(interfaceDeclarations, entity);
        }
    });

    entitiesWithAttributes.forEach(({ entity, attributes }) => {
        if (entity.type !== 'primitive') {
            fillProperties(interfaceDeclarations, schemaInterfaces, entity, attributes);
        }
    });

    annotationsFile.addTypeAliases(Object.values(typeAliasDeclarations));
    annotationsFile.addInterfaces(Object.values(interfaceDeclarations).sort((a, b) => a.name.localeCompare(b.name)));

    await project.save();

    Object.values(schemaInterfaces).forEach((declaration) => fs.appendFileSync(outputFile, declaration));
}

async function getEntitiesWithAttributes(): Promise<EntityWithAttributes[]> {
    const attributes = await fetchResources<Attribute>('Attribute');
    const entities = await fetchResources<Entity>('Entity');

    const mappingById: Record<string, EntityWithAttributes> = entities.reduce((acc, entity) => {
        acc[entity.id] = { entity, attributes: [] };

        return acc;
    }, {});

    const entitiesWithAttributesList = Object.values(
        attributes.reduce((acc, attribute) => {
            const entityId = attribute.resource.id;

            acc[entityId].attributes.push(attribute);

            return acc;
        }, mappingById),
    );

    return entitiesWithAttributesList
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

    if (interfaceName === 'Reference') {
        interfaceDeclarations[interfaceName] = {
            docs: entity.description ? [entity.description] : undefined,
            kind: StructureKind.Interface,
            isExported: true,
            name: `${interfaceName}<T extends Resource=any>`,
            properties: [
                {
                    name: 'resourceType',
                    type: `T["resourceType"]`,
                },
            ],
        };
    } else {
        interfaceDeclarations[interfaceName] = {
            docs: entity.description ? [entity.description] : undefined,
            kind: StructureKind.Interface,
            isExported: true,
            name:
                interfaceName === 'Bundle'
                    ? `${interfaceName}<T extends Resource=any>`
                    : interfaceName,
            properties:
                entity.type === 'resource' || interfaceName === 'Resource'
                    ? [
                        {
                            name: 'readonly resourceType',
                            type: `${
                                interfaceName === 'Resource' ? 'string' : `'${interfaceName}'`
                            }`,
                        },
                        { name: 'id', type: 'id', hasQuestionToken: true },
                        { name: 'meta', type: 'Meta', hasQuestionToken: true },
                    ]
                    : [],
        };
    }
}

function fillProperties(
    interfaceDeclarations: Record<string, InterfaceDeclarationStructure>,
    schemaInterfaces: Record<string, string>,
    entity: Entity,
    attributes: Attribute[],
) {
    const resourceType = entity.id;

    attributes.forEach((attribute) => {
        if (attribute.path[attribute.path.length - 1] === '*') {
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

            if (attribute.type?.id === 'Reference') {
                if (attribute.refers) {
                    const resourceNames = attribute.refers.map((v) => `${v}`).join(' | ');

                    return `AidboxReference<${resourceNames}>`;
                }

                return 'AidboxReference<any>';
            }

            // TODO: generalize
            if (entity.id === 'Bundle' && attribute.path.join('.') === 'entry') {
                return 'BundleEntry<T>';
            }

            const propertyInterfaceType = capitalize(
                convertPathToCamelCase([resourceType, ...attribute.path.filter((p) => p !== '*')]),
            );

            if (interfaceDeclarations[propertyInterfaceType] || schemaInterfaces[propertyInterfaceType]) {
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

        const wrapArrayType = (type: string) => {
            if (type.indexOf('<') !== -1) {
                return `Array<${type}>`;
            }

            return `${type}[]`;
        };

        const propertyType = getPropertyType();
        const property = {
            docs: getDocs(),
            type: attribute.isCollection ? wrapArrayType(propertyType) : propertyType,
            name: propertyName,
            hasQuestionToken: !attribute.isRequired,
        };

        if (interfaceDeclaration) {
            // Resource interface
            // Properties are always defined even if empty
            if (!interfaceDeclaration.properties!.find(({ name }) => name === property.name)) {
                interfaceDeclaration.properties!.push(property);
            }
        } else {
            // Auxiliary interface
            interfaceDeclarations[interfaceName] = {
                kind: StructureKind.Interface,
                isExported: true,
                name:
                    interfaceName === 'BundleEntry'
                        ? `${interfaceName}<T extends Resource=any>`
                        : interfaceName,
                properties: [property],
            };
        }
    }, {});
}
