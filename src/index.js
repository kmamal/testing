const Path = require('path')
const { isEqual } = require('@xyz/util/object')
const { timeout } = require('@xyz/util/promise')

let count_files = 0
let count_tests = 0
let count_failed = 0

const stack = []
let running = false
let files_done = false

const appendTest = (name, callback) => {
	stack.push({ name, callback })

	if (running) { return }
	running = true

	process.nextTick(runTests)
}

const runTest = async (callback) => {
	count_tests += 1

	let error = null
	let duration = 500
	let count_expected = null
	let count_actual = 0
	let schedule = null
	let start_time = null

	try {
		if (callback === undefined) {
			error = "NOT IMPLEMENTED"
			throw error
		}

		const promise = callback({
			expect: (n) => {
				count_expected = n
				count_actual = 0
			},
			timeout: (t) => { duration = t },
			//
			schedule: (steps, options = {}) => {
				schedule = [ ...steps ]
				const tollerance = options.tollerance || 20
				const propagate = options.propagate || true
				return {
					start: () => { start_time = Date.now() },
					step: (x) => {
						const elapsed = Date.now() - start_time

						if (schedule.length === 0) {
							const err = new Error("no steps left")
							err.step = [ elapsed, x ]
							throw err
						}

						const [ time, value ] = schedule.shift()

						if (!isEqual(value, x)) {
							const err = new Error("unexpected step")
							err.expected = [ time, value ]
							err.actual = [ elapsed, x ]
							throw err
						}

						const diff = elapsed - time
						if (Math.abs(diff) > tollerance) {
							const err = new Error("bad timing")
							err.expected = [ time, value ]
							err.actual = [ elapsed, x ]
							throw err
						}

						if (propagate) { start_time += diff }
					},
				}
			},
			//
			ok: (value, info) => {
				count_actual += 1
				if (value) { return }
				const err = new Error("not ok")
				info && Object.assign(err, info)
				throw err
			},
			assert: (cb, info) => {
				count_actual += 1
				if (cb()) { return }
				const err = new Error("assertion failed")
				info && Object.assign(err, info)
				err.callback = cb.toString()
				throw err
			},
			throws: async (cb, info) => {
				count_actual += 1
				try {
					await cb()
				} catch (expected) { return }
				const err = new Error("didn't throw")
				info && Object.assign(err, info)
				err.callback = cb.toString()
				throw err
			},
			equal: (actual, expected, info) => {
				count_actual += 1
				if (isEqual(actual, expected)) { return }
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
				stack.unshift({ name: _name, callback: _callback })
			},
		})

		if (promise) {
			const handleError = (err) => { error = error || err }
			process.on('unhandledRejection', handleError)
			process.on('uncaughtException', handleError)
			await Promise.race([ promise, timeout(duration) ])
			process.off('unhandledRejection', handleError)
			process.off('uncaughtException', handleError)
		}

		if (count_expected !== null && count_actual !== count_expected) {
			const err = new Error("wrong number")
			err.expected = count_expected
			err.actual = count_actual
			throw err
		}

		if (schedule && schedule.length > 0) {
			const err = new Error("missed steps")
			err.steps = schedule
			throw err
		}
	} catch (err) {
		error = error || err
	}

	return error
}

const runTests = async () => {
	while (stack.length > 0) {
		const item = stack.shift()

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
		const error = await runTest(callback)

		const args = [ name ]

		if (error) {
			args.push("->", error)
			count_failed += 1
		}

		console.log(...args)
	}

	if (files_done) {
		console.log(`files: ${count_files}`)
		console.log(`tests: ${count_tests}`)
		console.log(`failed: ${count_failed}`)

		process.exit(count_failed > 0 ? 1 : 0)
	}

	running = false
}

// Export own props, so the modules require()d through argv can import them.

module.exports = { test: appendTest }

const [ , , ...paths ] = process.argv

for (const path of paths) {
	count_files += 1

	stack.push(path)
	require(Path.resolve(path))
	stack.push(null)
}

files_done = true
