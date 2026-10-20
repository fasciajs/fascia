# @fasciajs/aws-filter

A term, written as the filter policy SNS and SQS deliver a message by.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and six targets, and neither side knows the other exists.

```sh
npm install @fasciajs/aws-filter
```

A policy is a predicate over a message. The schema a subscriber parses with says which messages the
subscriber can take, so the policy written from that schema delivers those messages to it. A tagged
union of events becomes `$or` over the tag, and a union of objects under a key becomes `$or` under
the key. An optional key gets `exists: false`, an optional object gets `$or` with the object that
lacks one of its keys, a range becomes a numeric condition, a pattern held to one end becomes a
prefix or a suffix, and any string in a body becomes `prefix: ""`.

```ts
import { spellFilterPolicy } from '@fasciajs/aws-filter'

spellFilterPolicy(term, 'sns:body').written
// { $or: [{ type: ['order.created'], total: [{ numeric: ['>=', 0] }] }, …] }
```

The scope is a required argument: `sns:attributes`, `sns:body`, `sqs:body` or `sqs:attributes`. Each
scope takes a different grammar. SNS counts keys and combinations, SQS attributes carry only strings,
and only a body holds an object under a key.

**A policy is never narrower than its schema.** It matches a list by any one member, it ignores a key
it does not name, and it has no condition for a length, a format or a whole number. Each of those is
written wider, and a departure names it. Where a policy states nothing, `written` is undefined: a
subscription with no policy. A policy that AWS would refuse is not written.

AWS answered for this target. lambada measured which policies SNS and Lambda take, and which messages
each policy delivered. The spec beside this package holds a matching function to every recorded
delivery, then holds every policy written from all four validators to that function.

An SNS attribute holding `"` or `\` is matched only where the publisher escapes it as JSON would.

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape.
