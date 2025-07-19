const std = @import("std");
const Document = @import("Document.zig");
const Node = Document.Node;
const assert = std.debug.assert;

/// A Markdown document renderer.
///
/// Each concrete `Renderer` type has a `renderDefault` function, with the
/// intention that custom `renderFn` implementations can call `renderDefault`
/// for node types for which they require no special rendering.
pub fn Renderer(comptime Writer: type, comptime Context: type) type {
    return struct {
        renderFn: *const fn (
            r: Self,
            doc: Document,
            node: Node.Index,
            writer: Writer,
        ) Writer.Error!void = renderDefault,
        context: Context,

        const Self = @This();

        pub fn render(r: Self, doc: Document, writer: Writer) Writer.Error!void {
            try r.renderFn(r, doc, .root, writer);
        }

        pub fn renderDefault(
            r: Self,
            doc: Document,
            node: Node.Index,
            writer: Writer,
        ) Writer.Error!void {
            const data = doc.nodes.items(.data)[@intFromEnum(node)];
            switch (doc.nodes.items(.tag)[@intFromEnum(node)]) {
                .root => {
                    for (doc.extraChildren(data.container.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                },
                .list => {
                    for (doc.extraChildren(data.list.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                },
                .list_item => {
                    try writer.writeAll("- ");
                    for (doc.extraChildren(data.list_item.children)) |child| {
                        if (data.list_item.tight and doc.nodes.items(.tag)[@intFromEnum(child)] == .paragraph) {
                            const para_data = doc.nodes.items(.data)[@intFromEnum(child)];
                            for (doc.extraChildren(para_data.container.children)) |para_child| {
                                try r.renderFn(r, doc, para_child, writer);
                            }
                        } else {
                            try r.renderFn(r, doc, child, writer);
                        }
                    }
                    try writer.writeAll("\n");
                },
                .table => {
                    for (doc.extraChildren(data.container.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                },
                .table_row => {
                    try writer.writeAll("|");
                    for (doc.extraChildren(data.container.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                    try writer.writeAll("\n");
                },
                .table_cell => {
                    try writer.writeAll(" ");
                    for (doc.extraChildren(data.table_cell.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                    try writer.writeAll(" |");
                },
                .heading => {
                    var i: u8 = 0;
                    while (i < data.heading.level) : (i += 1) {
                        try writer.writeAll("#");
                    }
                    try writer.writeAll(" ");
                    for (doc.extraChildren(data.heading.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                    try writer.writeAll("\n");
                },
                .code_block => {
                    const content = doc.string(data.code_block.content);
                    try writer.writeAll("```\n");
                    try writer.print("{s}", .{content});
                    try writer.writeAll("\n```\n");
                },
                .blockquote => {
                    try writer.writeAll("> ");
                    for (doc.extraChildren(data.container.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                },
                .paragraph => {
                    for (doc.extraChildren(data.container.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                    try writer.writeAll("\n\n");
                },
                .thematic_break => {
                    try writer.writeAll("---\n");
                },
                .link => {
                    const target = doc.string(data.link.target);
                    try writer.writeAll("[");
                    for (doc.extraChildren(data.link.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                    try writer.print("]({s})", .{target});
                },
                .autolink => {
                    const target = doc.string(data.text.content);
                    try writer.print("<{s}>", .{target});
                },
                .image => {
                    const target = doc.string(data.link.target);
                    try writer.writeAll("![");
                    for (doc.extraChildren(data.link.children)) |child| {
                        try renderInlineNodeText(doc, child, writer);
                    }
                    try writer.print("]({s})", .{target});
                },
                .strong => {
                    try writer.writeAll("**");
                    for (doc.extraChildren(data.container.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                    try writer.writeAll("**");
                },
                .emphasis => {
                    try writer.writeAll("*");
                    for (doc.extraChildren(data.container.children)) |child| {
                        try r.renderFn(r, doc, child, writer);
                    }
                    try writer.writeAll("*");
                },
                .code_span => {
                    const content = doc.string(data.text.content);
                    try writer.print("`{s}`", .{content});
                },
                .text => {
                    const content = doc.string(data.text.content);
                    try writer.print("{s}", .{content});
                },
                .line_break => {
                    try writer.writeAll("\\\n");
                },
            }
        }
    };
}

/// Renders an inline node as plain text. Asserts that the node is an inline and
/// has no non-inline children.
pub fn renderInlineNodeText(
    doc: Document,
    node: Node.Index,
    writer: anytype,
) @TypeOf(writer).Error!void {
    const data = doc.nodes.items(.data)[@intFromEnum(node)];
    switch (doc.nodes.items(.tag)[@intFromEnum(node)]) {
        .root,
        .list,
        .list_item,
        .table,
        .table_row,
        .table_cell,
        .heading,
        .code_block,
        .blockquote,
        .paragraph,
        .thematic_break,
        => unreachable, // Blocks

        .link, .image => {
            for (doc.extraChildren(data.link.children)) |child| {
                try renderInlineNodeText(doc, child, writer);
            }
        },
        .strong => {
            for (doc.extraChildren(data.container.children)) |child| {
                try renderInlineNodeText(doc, child, writer);
            }
        },
        .emphasis => {
            for (doc.extraChildren(data.container.children)) |child| {
                try renderInlineNodeText(doc, child, writer);
            }
        },
        .autolink, .code_span, .text => {
            const content = doc.string(data.text.content);
            try writer.print("{s}", .{content});
        },
        .line_break => {
            try writer.writeAll("\n");
        },
    }
}
