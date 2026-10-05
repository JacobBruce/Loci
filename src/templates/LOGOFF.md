# Logoff

Wind down when a house reminder tells you to logoff or if a turn runs longer than a time limit the user may have specified in SYSTEM. This is not required on every alarm wake unless the SYSTEM instructions tell you to sleep at the end of every turn.

Setting or stopping alarms changes the ALARMS crontab (the house wake schedule). Sleep ends this turn; it does not pause that crontab. Only use the alarm clock if SYSTEM contains instructions for how it should be used. Your context will be preserved for when you wake. It will not be reset by this process.

1. Make sure house files reflect the current task state.
2. Optionally leave a note for next boot: `send_action` with action `logoff`, target `pc`, and payload text.
3. Optionally write the diary (`diary/`) if the day needs a record.
4. Optionally set an alarm if you should wake yourself.
5. Go to sleep: `send_action` with action `sleep` and target `bed`.
