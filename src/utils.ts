import { InterfaceDeclarationStructure } from 'ts-morph';

import { genericAuxiliaryInterfaceAttributes, genericInterfaces } from './constants';
import { Attribute } from './types';

export const getPropertyType = (
    resourceType: string,
    attribute: Attribute,
    entityAttributes: Attribute[],
    interfaceDeclarations: Record<string, InterfaceDeclarationStructure>,
    schemaInterfaces: Record<string, string>,
) => {
    const [interfaceName, propertyName] = extractInterfaceNameAndPropertyName(
        resourceType,
        attribute.path,
    );
    const propertyInterfaceName = makePropertyInterfaceName(interfaceName, propertyName);

    if (attribute.type) {
        if (attribute.enum) {
            return attribute.enum.map((v) => `'${v}'`).join(' | ');
        }

        if (attribute.type.id === 'Reference') {
            if (attribute.refers) {
                const resourceNames = attribute.refers.map((v) => `${v}`).join(' | ');

                return `Reference<${resourceNames}>`;
            }

            return 'Reference<any>';
        }

        if (attribute.type.id === 'Map') {
            if (interfaceDeclarations[propertyInterfaceName]) {
                return `Record<string, ${propertyInterfaceName}>`;
            } else {
                return 'Record<string, any>';
            }
        }

        // Recursive
        const attrById = entityAttributes.find((attr) => attr.id === attribute.type.id);
        if (attrById) {
            return extractPropertyInterfaceName(resourceType, attrById.path);
        }

        // Generic
        if (
            genericAuxiliaryInterfaceAttributes[interfaceName] &&
            genericAuxiliaryInterfaceAttributes[interfaceName].indexOf(propertyName) !== -1
        ) {
            return 'T';
        }

        return attribute.type.id;
    }

    if (interfaceDeclarations[propertyInterfaceName]) {
        if (genericAuxiliaryInterfaceAttributes[propertyInterfaceName]) {
            return `${propertyInterfaceName}<T>`;
        }

        return propertyInterfaceName;
    }

    if (schemaInterfaces[propertyInterfaceName]) {
        return propertyInterfaceName;
    }

    return 'any';
};

export function extractDocs(attribute: Attribute) {
    let result = [];

    if (attribute.extensionUrl) {
        result.push(`NOTE: from extension ${attribute.extensionUrl}`);
    }

    if (attribute.description) {
        result.push(attribute.description);
    }

    return result;
}

export function extractInterfaceNameAndPropertyName(resourceType: string, path: string[]) {
    const nonWildCardPath = path.filter((p) => p !== '*');

    const interfaceName = capitalize(
        convertPathToCamelCase([
            resourceType,
            ...nonWildCardPath.slice(0, nonWildCardPath.length - 1),
        ]),
    );
    const propertyName = nonWildCardPath[nonWildCardPath.length - 1];

    return [interfaceName, propertyName];
}

export function extractPropertyInterfaceName(resourceType: string, path: string[]) {
    const [interfaceName, propertyName] = extractInterfaceNameAndPropertyName(resourceType, path);

    return makePropertyInterfaceName(interfaceName, propertyName);
}

function makePropertyInterfaceName(interfaceName: string, propertyName: string) {
    return `${interfaceName}${capitalize(convertPathToCamelCase([propertyName]))}`;
}

export function wrapInterfaceName(interfaceName: string) {
    return genericInterfaces.indexOf(interfaceName) !== -1
        ? `${interfaceName}<T extends Resource=any>`
        : interfaceName;
}

export function wrapPropertyName(name: string) {
    if (name.indexOf('-') !== -1) {
        return `'${name}'`;
    }

    return name;
}

export function wrapArrayType(type: string) {
    if (type.indexOf('<') !== -1) {
        return `Array<${type}>`;
    }

    return `${type}[]`;
}

function toCamelCase(str: string) {
    // Lower cases the string
    return (
        str
            // Replaces any - or _ characters with a space
            .replace(/[-_]+/g, ' ')
            // Removes any non alphanumeric characters
            .replace(/[^\w\s]/g, '')
            // Uppercases the first character in each group immediately following a space
            // (delimited by spaces)
            .replace(/ (.)/g, function ($1) {
                return $1.toUpperCase();
            })
            // Removes spaces
            .replace(/ /g, '')
    );
}

function capitalize(str: string) {
    return str.length > 0 ? `${str.charAt(0).toUpperCase()}${str.slice(1)}` : '';
}

function convertPathToCamelCase(strs: string[]) {
    return strs.reduce((accum, curr) => {
        return `${accum}${capitalize(toCamelCase(curr))}`;
    }, '');
}
