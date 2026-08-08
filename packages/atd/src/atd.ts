/**
 * Arri Type Definition, as arri publishes it.
 *
 * `@arrirpc/type-defs` is arri's own declaration of the schema, and this file names it rather than
 * restating it. A first version was written from the specification's prose and was wrong in a way
 * the prose could not have shown: it made `properties` optional on the properties form, where arri
 * requires it.
 *
 * That mistake is worth keeping in view. An object whose keys are all optional emitted
 * `{ optionalProperties: … }` with no `properties`, and arri reads that as the **empty form**, which
 * accepts any value at all. `isSchema` returns true for it, so a check asking only whether a
 * document is legal would have passed a document that accepts everything.
 */
export type {
  AppDefinition as AtdApp,
  HttpRpcDefinition as AtdHttpProcedure,
  RpcDefinition as AtdProcedure,
  RpcHttpMethod as AtdHttpMethod,
  Schema as AtdSchema,
  SchemaFormDiscriminator as AtdDiscriminator,
  SchemaFormElements as AtdElements,
  SchemaFormEmpty as AtdEmpty,
  SchemaFormEnum as AtdEnum,
  SchemaFormProperties as AtdProperties,
  SchemaFormRef as AtdRef,
  SchemaFormType as AtdTypeForm,
  SchemaFormValues as AtdValues,
  SchemaMetadata as AtdMetadata,
  Type as AtdType,
  WsRpcDefinition as AtdWsProcedure
} from '@arrirpc/type-defs'

export {
  HttpMethodValues as AtdHttpMethods,
  isAppDefinition as isAtdApp,
  isRpcDefinition as isAtdProcedure,
  isSchema as isAtdSchema,
  isSchemaFormDiscriminator as isAtdDiscriminator,
  isSchemaFormElements as isAtdElements,
  isSchemaFormEnum as isAtdEnum,
  isSchemaFormProperties as isAtdProperties,
  isSchemaFormRef as isAtdRef,
  isSchemaFormType as isAtdTypeForm,
  isSchemaFormValues as isAtdValues,
  SCHEMA_VERSION as ATD_SCHEMA_VERSION,
  TypeValues as AtdTypeNames
} from '@arrirpc/type-defs'
