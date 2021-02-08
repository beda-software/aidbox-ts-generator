export const capitalize = (str: string) =>
    str.length > 0 ? `${str.charAt(0).toUpperCase()}${str.slice(1)}` : '';

export function convertPathToCamelCase(strs: string[]) {
    return strs.reduce((accum, curr) => {
        return `${accum}${capitalize(toCamelCase(curr))}`;
    }, '');
}

export function preparePropertyName(name: string) {
    if (name.indexOf('-') !== -1) {
        return `'${name}'`;
    }

    return name;
}

export function toCamelCase(str: string) {
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
