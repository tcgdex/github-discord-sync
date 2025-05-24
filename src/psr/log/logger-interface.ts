import type LogLevel from './LogLevel'

/**
 * Describes a logger instance.
 *
 * The message MUST be a string or object implementing __toString().
 *
 * The message MAY contain placeholders in the form: {foo} where foo
 * will be replaced by the context data in key "foo".
 *
 * The context array can contain arbitrary data, the only assumption that
 * can be made by implementors is that if an Exception instance is given
 * to produce a stack trace, it MUST be in a key named "exception".
 *
 * See https://github.com/php-fig/fig-standards/blob/master/accepted/PSR-3-logger-interface.md
 * for the full interface specification.
 */
export default interface LoggerInterface {
	/**
	 * System is unusable.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	emergency(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Action must be taken immediately.
	 *
	 * Example: Entire website down, database unavailable, etc. This should
	 * trigger the SMS alerts and wake you up.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	alert(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Critical conditions.
	 *
	 * Example: Application component unavailable, unexpected exception.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	critical(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Runtime errors that do not require immediate action but should typically
	 * be logged and monitored.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	error(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Exceptional occurrences that are not errors.
	 *
	 * Example: Use of deprecated APIs, poor use of an API, undesirable things
	 * that are not necessarily wrong.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	warning(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Normal but significant events.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	notice(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Interesting events.
	 *
	 * Example: User logs in, SQL logs.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	info(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Detailed debug information.
	 *
	 * @param string $message
	 * @param array $context
	 * @return void
	 */
	debug(message?: any, ...optionalParams: Array<any>): void

	/**
	 * Logs with an arbitrary level.
	 *
	 * @param mixed $level
	 * @param string $message
	 * @param array $context
	 * @return void
	 */

	log(level: LogLevel, message?: any, ...optionalParams: Array<any>): void
}
