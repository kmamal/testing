const { defaultRunner } = require('./runner')

module.exports = {
	test: (...args) => { defaultRunner.appendTest(...args) },
}
