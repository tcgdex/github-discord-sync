import LogLevel from './log-level'
import LoggerAbstract from './logger-abstract'

export default class ConsoleLogger extends LoggerAbstract {
	private readonly console: Console

	public constructor(
		obj: Console = console
	) {
		super()
		this.console = obj
	}

	public override log(level: LogLevel, message?: any, ...optionalParams: Array<any>): void {
		if (this.canLog(level)) {
			this.console.log(this.processLog(level, message, optionalParams))
		}
	}
}
