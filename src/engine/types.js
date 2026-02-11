/**
 * @typedef {Object} Resources
 * @property {number} food
 * @property {number} wood
 * @property {number} water
 * @property {number} materials
 */

/**
 * @typedef {Object} AgentTraits
 * @property {number} curiosite
 * @property {number} intelligence
 * @property {number} agressivite
 * @property {number} prudence
 * @property {number} patience
 * @property {number} conscience_ecologique
 */

/**
 * @typedef {Object} Tile
 * @property {number} x
 * @property {number} y
 * @property {number} altitude
 * @property {number} temperature
 * @property {number} humidity
 * @property {string} biome
 * @property {Resources} resources
 * @property {Resources} resourceCaps
 */

/**
 * @typedef {Object} AgentState
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} energy
 * @property {number} health
 * @property {number} age
 * @property {AgentTraits} traits
 * @property {string[]} memory
 * @property {boolean} isAlive
 */

/**
 * @typedef {Object} TribeState
 * @property {string} id
 * @property {string[]} members
 * @property {{food:number, wood:number, materials:number}} sharedResources
 * @property {{x:number, y:number}} center
 * @property {number} stability
 */

/**
 * @typedef {Object} WorldMap
 * @property {number} width
 * @property {number} height
 * @property {string} seed
 * @property {Tile[]} tiles
 */

export const TYPE_DOC = 'Types centralisés en JSDoc pour garder une architecture claire en JavaScript.';
