export interface Attribute {
    resourceType: 'Attribute';
    id: string;
    description?: string;
    type: any;
    path: string[];
    isCollection?: boolean;
    isRequired?: boolean;
    isOpen?: boolean;
    schema?: any;
    enum?: string[];
    refers?: string[];
    _source?: string;
    extensionUrl?: string;
    resource: { resourceType: 'Entity'; id: string };
}

export interface Entity {
    resourceType: 'Entity';

    id: string;
    description?: string;
    type?: string;
    _source?: string;
}

export interface EntityWithAttributes {
    entity: Entity;
    attributes: Attribute[];
}
