import { decompose } from "./decompose.js"
import { sortRecipe } from "./sort-recipe.js"
import { escapeString } from "./escapeString.js"

export const uneval = (value, { functionAllowed = false } = {}) => {
  const { recipeArray, mainIdentifier, valueMap } = decompose(value, { functionAllowed })
  const recipeArraySorted = sortRecipe(recipeArray)

  let source = `(function () {
Object.defineProperty(Object.prototype, "__global__", {
  get: function () { return this },
  configurable: true,
});
var globalObject = __global__;
delete Object.prototype.__global__;

function safeDefineProperty(object, propertyNameOrSymbol, descriptor) {
  var currentDescriptor = Object.getOwnPropertyDescriptor(object, propertyNameOrSymbol);
  if (currentDescriptor && !currentDescriptor.configurable) return
  Object.defineProperty(object, propertyNameOrSymbol, descriptor)
};
`

  const variableNameMap = {}
  recipeArray.forEach((recipe, index) => {
    const indexSorted = recipeArraySorted.indexOf(recipe)
    variableNameMap[index] = `_${indexSorted}`
  })

  const identifierToVariableName = (identifier) => variableNameMap[identifier]

  const recipeToSetupSource = (recipe) => {
    if (recipe.type === "primitive") return primitiveRecipeToSetupSource(recipe)
    if (recipe.type === "global-symbol") return globalSymbolRecipeToSetupSource(recipe)
    if (recipe.type === "global-reference") return globalReferenceRecipeToSetupSource(recipe)
    return compositeRecipeToSetupSource(recipe)
  }

  const primitiveRecipeToSetupSource = ({ value }) => {
    if (typeof value === "string") return `"${escapeString(value)}";`
    if (Object.is(value, -0)) return "-0;"
    return `${String(value)};`
  }

  const globalSymbolRecipeToSetupSource = (recipe) => {
    return `Symbol.for("${escapeString(recipe.key)}");`
  }

  const globalReferenceRecipeToSetupSource = (recipe) => {
    const pathSource = recipe.path.map((part) => `["${escapeString(part)}"]`).join("")
    return `globalObject${pathSource};`
  }

  const compositeRecipeToSetupSource = ({ prototypeIdentifier, valueOfIdentifier }) => {
    if (prototypeIdentifier === undefined) return identifierToVariableName(valueOfIdentifier)

    const prototypeValue = valueMap[prototypeIdentifier]
    if (prototypeValue === null) return `Object.create(null);`

    const prototypeConstructor = prototypeValue.constructor
    if (prototypeConstructor === Object)
      return `Object.create(${identifierToVariableName(prototypeIdentifier)});`

    if (valueOfIdentifier === undefined) return `new ${prototypeConstructor.name}();`

    return `new ${prototypeConstructor.name}(${identifierToVariableName(valueOfIdentifier)});`
  }

  recipeArraySorted.forEach((recipe) => {
    const recipeVariableName = identifierToVariableName(recipeArray.indexOf(recipe))
    source += `var ${recipeVariableName} = ${recipeToSetupSource(recipe, recipeVariableName)}
`
  })

  const recipeToMutateSource = (recipe, recipeVariableName) => {
    if (recipe.type === "composite")
      return compositeRecipeToMutateSource(recipe, recipeVariableName)
    return ``
  }

  const compositeRecipeToMutateSource = (
    { propertyDescriptionArray, symbolDescriptionArray, methodDescriptionArray, extensible },
    recipeVariableName,
  ) => {
    let mutateSource = ``

    propertyDescriptionArray.forEach(({ propertyNameIdentifier, propertyDescription }) => {
      mutateSource += generateDefinePropertySource(
        recipeVariableName,
        propertyNameIdentifier,
        propertyDescription,
      )
    })

    symbolDescriptionArray.forEach(({ symbolIdentifier, propertyDescription }) => {
      mutateSource += generateDefinePropertySource(
        recipeVariableName,
        symbolIdentifier,
        propertyDescription,
      )
    })

    methodDescriptionArray.forEach(({ methodNameIdentifier, callArray }) => {
      mutateSource += generateMethodCallSource(recipeVariableName, methodNameIdentifier, callArray)
    })

    if (!extensible) {
      mutateSource += generatePreventExtensionSource(recipeVariableName)
    }

    return mutateSource
  }

  const generateDefinePropertySource = (
    recipeVariableName,
    propertyNameOrSymbolIdentifier,
    propertyDescription,
  ) => {
    const propertyOrSymbolVariableName = identifierToVariableName(propertyNameOrSymbolIdentifier)

    const propertyDescriptorSource = generatePropertyDescriptorSource(propertyDescription)
    return `safeDefineProperty(${recipeVariableName}, ${propertyOrSymbolVariableName}, ${propertyDescriptorSource});`
  }

  const generatePropertyDescriptorSource = ({
    configurable,
    writable,
    enumerable,
    getIdentifier,
    setIdentifier,
    valueIdentifier,
  }) => {
    if (valueIdentifier === undefined) {
      return `{
  configurable: ${configurable},
  enumerable: ${enumerable},
  get: ${getIdentifier === undefined ? undefined : identifierToVariableName(getIdentifier)},
  set: ${setIdentifier === undefined ? undefined : identifierToVariableName(setIdentifier)},
}`
    }

    return `{
  configurable: ${configurable},
  writable: ${writable},
  enumerable: ${enumerable},
  value: ${valueIdentifier === undefined ? undefined : identifierToVariableName(valueIdentifier)}
}`
  }

  const generateMethodCallSource = (recipeVariableName, methodNameIdentifier, callArray) => {
    let methodCallSource = ``

    const methodVariableName = identifierToVariableName(methodNameIdentifier)
    callArray.forEach((argumentIdentifiers) => {
      const argumentVariableNames = argumentIdentifiers.map((argumentIdentifier) =>
        identifierToVariableName(argumentIdentifier),
      )

      methodCallSource += `${recipeVariableName}[${methodVariableName}](${argumentVariableNames.join(
        ",",
      )});`
    })

    return methodCallSource
  }

  const generatePreventExtensionSource = (recipeVariableName) => {
    return `Object.preventExtensions(${recipeVariableName});`
  }

  recipeArraySorted.forEach((recipe) => {
    const recipeVariableName = identifierToVariableName(recipeArray.indexOf(recipe))
    source += `${recipeToMutateSource(recipe, recipeVariableName)}`
  })

  source += `return ${identifierToVariableName(mainIdentifier)}; })()`

  return source
}
