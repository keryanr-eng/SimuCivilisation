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
 * @typedef {Object} TribeCulture
 * @property {number} tech
 * @property {number} war
 * @property {number} education
 * @property {number} trade
 * @property {number} ecology
 * @property {number} spirituality
 */

/**
 * @typedef {Object} Belief
 * @property {string} id
 * @property {"survival"|"war"|"trade"|"ecology"|"ritual"} type
 * @property {string} trigger
 * @property {Object} effect
 * @property {number} strength
 * @property {number} age
 */

/**
 * @typedef {Object} Technology
 * @property {string} id
 * @property {number} level
 * @property {number} progress
 * @property {number} cost
 * @property {{efficiencyBonus:number, storageBonus:number, movementBonus:number, defenseBonus:number, tradeBonus:number}} effects
 */

/**
 * @typedef {Object} TribeState
 * @property {string} id
 * @property {string[]} members
 * @property {{food:number, wood:number, materials:number}} sharedResources
 * @property {{x:number, y:number}} center
 * @property {number} stability
 * @property {TribeCulture} culture
 * @property {Belief[]} beliefs
 * @property {{[id:string]: Technology}} technologies
 * @property {number} techProgressRate
 * @property {number} globalTechLevel
 */

/**
 * @typedef {Object} InteractionMemoryRecord
 * @property {{a:string, b:string}} lastActions
 * @property {number} trustScore
 * @property {number} lastTick
 * @property {number} totalTrades
 * @property {number} totalCooperations
 * @property {number} totalBetrays
 * @property {number} totalAttacks
 * @property {number} totalAvoids
 */

/**
 * @typedef {Object} WorldMap
 * @property {number} width
 * @property {number} height
 * @property {string} seed
 * @property {Tile[]} tiles
 */

export const TYPE_DOC = 'Types centralisés en JSDoc pour garder une architecture claire en JavaScript.';
