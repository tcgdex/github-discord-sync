/* eslint-disable @typescript-eslint/no-unsafe-argument */
import LogLevel from './log-level'
import type LoggerInterface from './logger-interface'
import { Color } from './color'

const order: Array<LogLevel> = [
	LogLevel.DEBUG,
	LogLevel.INFO,
	LogLevel.NOTICE,
	LogLevel.WARNING,
	LogLevel.ERROR,
	LogLevel.CRITICAL,
	LogLevel.ALERT,
	LogLevel.EMERGENCY,
]


export default abstract class LoggerAbstract implements LoggerInterface {
	public emergency(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.EMERGENCY, message, ...optionalParams)
	}

	public alert(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.ALERT, message, ...optionalParams)
	}

	public critical(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.CRITICAL, message, ...optionalParams)
	}

	public error(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.ERROR, message, ...optionalParams)
	}

	public warning(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.WARNING, message, ...optionalParams)
	}

	public notice(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.NOTICE, message, ...optionalParams)
	}

	public info(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.INFO, message, ...optionalParams)
	}

	public debug(message?: any, ...optionalParams: Array<any>): void {
		this.log(LogLevel.DEBUG, message, ...optionalParams)
	}

	/**
	 * process the log line into a standardized one
	 *
	 * note: it by itself does not add the final `\n`
	 * @param level the log level
	 * @param message the message to send
	 * @param context the message context
	 * @param colors should the message have colors ?
	 * @returns the processed message
	 */
	protected processLog(level: LogLevel, message?: any, optionalParams: Array<any> = [], colors = false) {
		const now = new Date()
		let final = this.stringify(message)

		for (const item of optionalParams) {
			final += ` ${this.stringify(item)}`
		}

		// if (context) {
		// 	const clone = objectClone(context, { deep: false })
		// 	objectLoop(context, (value, key) => {
		// 		try {
		// 			final = final.replace(new RegExp(`{${key}}`, 'g'), this.stringify(value))
		// 			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
		// 			delete clone[key]
		// 		} catch {
		// 			final += `${value}`
		// 		}
		// 	})
		// 	if (objectSize(clone) > 0) {
		// 		final += ` (${JSON.stringify(context)})`
		// 	}
		// }

		let prefix = `[${now.toISOString()}] ${level}:`
		if (colors) {
			const levelColor = level === LogLevel.ERROR ? Color.Red : level === LogLevel.WARNING ? Color.Yellow : Color.Cyan
			prefix = `${Color.Reset}${Color.Dim}[${Color.Yellow}${now.toISOString()}${Color.Reset}${Color.Dim}] ${levelColor}${level.padStart(9, ' ')}${Color.Reset}:${Color.Green}${Color.Bright}`
		}

		return `${prefix} ${this.prefixLines(final, prefix)}`
	}

	protected canLog(level: LogLevel): boolean {
		let logLevel = Math.max(0, Math.min(parseInt(process.env.LOG_LEVEL || '4', 10), order.length - 1))
		if (isNaN(logLevel)) {
			logLevel = 0
		}
		const index = order.indexOf(level)
		return index >= logLevel
	}

	private prefixLines(text: string, prefix: string): string {
		return text.split('\n').join('\n' + prefix + ' ')
	}

	private stringify(content: any): string {
		if (typeof content === 'string') {
			return content
		}

		if (content instanceof Error) {
			return `${content.name}: ${content.message}\n${content.stack}`
		}

		return JSON.stringify(content)
	}

	public abstract log(level: LogLevel, message?: any, ...optionalParams: Array<any>): void
}
