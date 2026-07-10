Schema: Defines date params and assigns each either Number or String type. Params are ordered from
most coarse to most fine-grained.

- For String type, the user must provide the list of accepted values and their order.

In defining a calendar, the user must define:

- Schema
- An epoch date (the date that corresponds to 0 tick value)
- For each parameter in the schema:
  - Duration
    - If not the last parameter, the user must define how many units of the next parameter go into one unit of
      the current parameter.
      - If the next parameter is String, the user must provide the list of accepted values and
        their order.
      - If the next parameter is a Number, the user must provide the range (from, to)
        inclusive and the step value. If step value is positive the range must be ascending, if step
        value is negative the range must be descending.
      - Instead of constants for these, the user may provide a function (DSL explained below) that
        returns the list/range of accepted values for the next parameter.
    - If the last parameter, the user must define how many tick units go into one unit of the last
      parameter. The user may provide a function (DSL explained below) that returns the number of
      tick units for the last parameter. 
    - For total calendar duration, there are 3 cases:
        - If the top parameter is a String, the user may specify whether the calendar is cyclic or
          terminating. If cyclic, the calendar is assumed to iterate through the previously given
          list; if terminating, the calendar is assumed to terminate after the last value in the
          list, unless the user specifically provides a 
  - Formatting
    - Pretty formatting rule: Optional. If not provided, the default formatting rule is used:
      each parameter is printed in order, separated by a space, with names for string-valued
      parameters used. The formatting rule at a given parameter lists everything up to that
      parameter: so the month formatting rule is "YYYY M" and the day formatting rule is "YYYY M D".
    - Short formatting rule: Optional. If not provided, the default formatting rule is used:
      each parameter is printed in order, separated by a forward slash, with ordinals for string-valued
      parameters used.

We need a simple DSL for these rulesets. The DSL needs the following features:

- Ability to define variables and assign them values.
- Base types: Number, Boolean, String, List[String]
- Base operations: +, -, \*, /, %, ==, !=, <, >, <=, >=, and, or, not, ceil, floor, min, max, in,
  if/then/else, return
- "in" applies to checking strings in lists of strings
- == can compare numbers or strings
- Allowed starting variables: {param_name} for each parameter in the schema
- Some way to format strings with variables, e.g. "The value is {param_name}" - for numbers would be
  nice to offer formatting options like "The value is {param_name:0.2f}" for 2 decimal places, or
  "The value is {param_name:02d}" for 2 digits with leading zeros.
- Type checking and path completeness - all if/then/else branches must return the same type, and
  there must always be an else branch. 
- Aesthetically, something SQL-esque to make it easy to read and write.

DSL to be specified in combination of EBNF and Pratt parsing. The EBNF will define the grammar, and
the Pratt parsing will define the operator precedence and associativity.

After a calendar is defined, the rules will be used for the following operations:
- Converting a tick value to a date
   - The tick value is divided by the number of tick units in the last parameter to get the number of
     units of the last parameter. The remainder is used to calculate the next parameter, and so on,
     until all parameters are calculated.