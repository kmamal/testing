const Path = require('path')
const Util = require('util')
const { isEqual } = require('@kmamal/util/object/is-equal')
const { timeout } = require('@kmamal/util/promise/timeout')


class TestRunner {
	constructor () {
		this.countFiles = 0
		this.countTests = 0
		this.countFailed = 0

		this.stack = []
		this.running = false
		this.filesDone = false
	}

	appendTest (name, callback) {
		this.stack.push({ name, callback })

		if (this.running) { return }
		this.running = true

		process.nextTick(() => this.runTests())
	}

	async runTest (callback) {
		this.countTests += 1

		let error = null
		let shouldSortKeys = false
		let duration = 500
		let countExpected = null
		let countActual = 0
		let schedule = null
		let startTime = null

		const handleError = (err) => { error ??= err }
		process.on('unhandledRejection', handleError)
		process.on('uncaughtException', handleError)

		try {
			if (callback === undefined) {
				error = "NOT IMPLEMENTED"
				throw error
			}

			const promise = callback({
				expect: (n) => {
					countExpected = n
					countActual = 0
				},
				timeout: (t) => { duration = t },
				//
				schedule: (steps, options = {}) => {
					schedule = [ ...steps ]
					const tollerance = options.tollerance || 20
					const propagate = options.propagate || true
					return {
						start: () => { startTime = Date.now() },
						step: (...x) => {
							const elapsed = Date.now() - startTime

							if (schedule.length === 0) {
								const err = new Error("no steps left")
								err.step = [ elapsed, ...x ]
								throw err
							}

							const [ time, ...value ] = schedule.shift()

							if (!isEqual(value, x)) {
								const err = new Error("unexpected step")
								err.expected = [ time, ...value ]
								err.actual = [ elapsed, ...x ]
								throw err
							}

							const diff = elapsed - time
							if (Math.abs(diff) > tollerance) {
								const err = new Error("bad timing")
								err.expected = [ time, ...value ]
								err.actual = [ elapsed, ...x ]
								throw err
							}

							if (propagate) { startTime += diff }
						},
					}
				},
				//
				ok: (value, info, sort = false) => {
					countActual += 1
					if (value) { return }
					shouldSortKeys = sort
					const err = new Error("not ok")
					info && Object.assign(err, info)
					throw err
				},
				throwsNot: (cb, info, sort = false) => {
					countActual += 1
					try {
						cb()
					} catch (_err) {
						shouldSortKeys = sort
						const err = new Error("did throw")
						info && Object.assign(err, info)
						err.callback = cb.toString()
						err.error = _err
						throw err
					}
				},
				throwsNotAsync: async (cb, info, sort = false) => {
					countActual += 1
					try {
						await cb()
					} catch (_err) {
						shouldSortKeys = sort
						const err = new Error("did throw")
						info && Object.assign(err, info)
						err.callback = cb.toString()
						err.error = _err
						throw err
					}
				},
				throws: (cb, info, sort = false) => {
					countActual += 1
					try {
						cb()
					} catch (expected) { return }
					shouldSortKeys = sort
					const err = new Error("didn't throw")
					info && Object.assign(err, info)
					err.callback = cb.toString()
					throw err
				},
				throwsAsync: async (cb, info, sort = false) => {
					countActual += 1
					try {
						await cb()
					} catch (expected) { return }
					shouldSortKeys = sort
					const err = new Error("didn't throw")
					info && Object.assign(err, info)
					err.callback = cb.toString()
					throw err
				},
				throwsWith: (cb, assert, info, sort = false) => {
					countActual += 1
					try {
						cb()
					} catch (expected) {
						assert(expected)
						return
					}
					shouldSortKeys = sort
					const err = new Error("didn't throw")
					info && Object.assign(err, info)
					err.callback = cb.toString()
					throw err
				},
				throwsWithAsync: async (cb, assert, info, sort = false) => {
					countActual += 1
					try {
						await cb()
					} catch (expected) {
						await assert(expected)
						return
					}
					shouldSortKeys = sort
					const err = new Error("didn't throw")
					info && Object.assign(err, info)
					err.callback = cb.toString()
					throw err
				},
				equal: (actual, expected, info, sort = false) => {
					countActual += 1
					if (isEqual(actual, expected)) { return }
					shouldSortKeys = sort
					const err = new Error("not equal")
					info && Object.assign(err, info)
					err.expected = expected
					err.actual = actual
					throw err
				},
				fail: (info) => {
					const err = new Error("failed")
					info && Object.assign(err, info)
					throw err
				},
				test: (_name, _callback) => {
					this.stack.unshift({ name: _name, callback: _callback })
				},
			})

			if (promise) {
				await Promise.race([ promise, timeout(duration) ])
			}

			if (countExpected !== null && countActual !== countExpected) {
				const err = new Error("wrong number")
				err.expected = countExpected
				err.actual = countActual
				throw err
			}

			if (schedule && schedule.length > 0) {
				const err = new Error("missed steps")
				err.steps = schedule
				throw err
			}
		} catch (err) {
			error ??= err
		} finally {
			process.off('unhandledRejection', handleError)
			process.off('uncaughtException', handleError)
		}

		return { error, shouldSortKeys }
	}

	async runTests () {
		while (this.stack.length > 0) {
			const item = this.stack.shift()

			if (typeof item === 'string') {
				console.group(item)
				continue
			}

			if (item === null) {
				console.groupEnd()
				console.log()
				continue
			}

			const { name, callback } = item
			const { error, shouldSortKeys } = await this.runTest(callback)

			const args = [ name ]

			if (error) {
				args.push("->", Util.inspect(error, {
					depth: Infinity,
					colors: true,
					breakLength: process.stdout.columns,
					sorted: shouldSortKeys,
				}))
				this.countFailed += 1
			}

			console.log(...args)
		}

		if (this.filesDone) {
			console.log(`files: ${this.countFiles}`)
			console.log(`tests: ${this.countTests}`)
			console.log(`failed: ${this.countFailed}`)

			process.exit(this.countFailed > 0 ? 1 : 0)
		}

		this.running = false
	}

	appendFile (path) {
		this.countFiles += 1

		this.stack.push(path)
		require(Path.resolve(path))
		this.stack.push(null)
	}

	finish () {
		this.filesDone = true
		this.runTests()
	}
}

const defaultRunner = new TestRunner()

module.exports = {
	TestRunner,
	defaultRunner,
}
