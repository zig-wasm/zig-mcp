const std = @import("std");

pub fn build(b: *std.Build) !void {
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseSmall });

    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .cpu_features_add = std.Target.wasm.featureSet(&.{
            .atomics,
            .bulk_memory,
            .multivalue,
            .mutable_globals,
            .nontrapping_fptoint,
            .reference_types,
            .sign_ext,
        }),
    });

    const wasm_exe = b.addExecutable(.{
        .name = "main",
        .root_module = b.createModule(.{
            .root_source_file = b.path("docs/wasm/main.zig"),
            .target = wasm_target,
            .optimize = optimize,
        }),
    });

    const walk_module = b.createModule(.{
        .root_source_file = b.path("docs/wasm/Walk.zig"),
    });
    wasm_exe.root_module.addImport("Walk", walk_module);

    wasm_exe.entry = .disabled;
    wasm_exe.rdynamic = true;

    const install_wasm = b.addInstallArtifact(wasm_exe, .{
        .dest_dir = .{ .override = .prefix },
    });

    b.getInstallStep().dependOn(&install_wasm.step);
}
