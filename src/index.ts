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
import {
    extractDocs,
    extractInterfaceNameAndPropertyName,
    extractPropertyInterfaceName,
    wrapPropertyName,
    wrapArrayType,
    wrapInterfaceName,
    getPropertyType,
} from './utils';

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
            type: 'string',
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
    .catch((err) => console.error('Error while generating', err));

function getAuthHeaders() {
    if (authorizationHeader) {
        return { Authorization: authorizationHeader };
    }

    if (username && password) {
        return {
            Authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
        };
    }

    return {};
}

function fetchResources<T extends { resourceType: string }>(
    resourceType: T['resourceType'],
): Promise<T[]> {
    return fetch(`${baseUrl}/${resourceType}/$dump`, {
        headers: {
            'Content-Type': 'application/json',
            ...(getAuthHeaders() as Headers),
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
        docs: ['Deprecated. Use Resource instead'],
    };
    typeAliasDeclarations.AidboxReference = {
        kind: StructureKind.TypeAlias,
        name: 'AidboxReference<T extends Resource=any>',
        isExported: true,
        type: `Reference<T>`,
        docs: ['Deprecated. Use Reference instead'],
    };

    entitiesWithAttributes.forEach(({ entity, attributes }) => {
        const resourceType = entity.id;

        attributes.forEach(async (attribute) => {
            if (attribute.schema) {
                const propertyInterfaceName = extractPropertyInterfaceName(
                    resourceType,
                    attribute.path,
                );

                try {
                    schemaInterfaces[propertyInterfaceName] = await compile(
                        attribute.schema,
                        propertyInterfaceName,
                    );
                } catch (err) {
                    console.warn(
                        `Skipping schema generation for ${propertyInterfaceName} due to errors`,
                    );
                }
            }
        });
    });

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
    annotationsFile.addInterfaces(
        Object.values(interfaceDeclarations).sort((a, b) => a.name.localeCompare(b.name)),
    );

    await project.save();

    Object.values(schemaInterfaces).forEach((declaration) =>
        fs.appendFileSync(outputFile, declaration),
    );
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
                { name: 'id', type: 'id' },
            ],
        };
    } else {
        interfaceDeclarations[interfaceName] = {
            docs: entity.description ? [entity.description] : undefined,
            kind: StructureKind.Interface,
            isExported: true,
            name: wrapInterfaceName(interfaceName),
            properties:
                entity.type === 'resource' || interfaceName === 'Resource'
                    ? [
                          {
                              name: 'readonly resourceType',
                              type: `${
                                  interfaceName === 'Resource' ? 'string' : `'${interfaceName}'`
                              }`,
                          },
                          { name: 'id', type: 'id' },
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
        // Skip attributes that define only auxiliary interface without the attribute
        if (attribute.path[attribute.path.length - 1] === '*') {
            return;
        }

        const [interfaceName, propertyName] = extractInterfaceNameAndPropertyName(
            resourceType,
            attribute.path,
        );
        const propertyType = getPropertyType(
            resourceType,
            attribute,
            attributes,
            interfaceDeclarations,
            schemaInterfaces,
        );
        const property = {
            docs: extractDocs(attribute),
            type: attribute.isCollection ? wrapArrayType(propertyType) : propertyType,
            name: wrapPropertyName(propertyName),
            hasQuestionToken: !attribute.isRequired,
        };

        const interfaceDeclaration = interfaceDeclarations[interfaceName];
        if (interfaceDeclaration) {
            // Append property to interface declaration
            // Properties are always defined even if empty - that's why we use !
            if (!interfaceDeclaration.properties!.find(({ name }) => name === property.name)) {
                interfaceDeclaration.properties!.push(property);
            }
        } else {
            // Create new auxiliary interface declaration with first property
            interfaceDeclarations[interfaceName] = {
                kind: StructureKind.Interface,
                isExported: true,
                name: wrapInterfaceName(interfaceName),
                properties: [property],
            };
        }
    }, {});
}
