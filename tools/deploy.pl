#!/usr/bin/env perl
# Deploy the static Coeso site to Vercel using only core Perl + curl.
# Usage: VERCEL_TOKEN=... perl tools/deploy.pl [project-name]
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(encode_base64);

my $token = $ENV{VERCEL_TOKEN} // '';
if (!$token && -f '.env') {
    open my $fh, '<', '.env' or die ".env: $!";
    while (my $line = <$fh>) {
        $token = $1 if $line =~ /^\s*VERCEL_TOKEN\s*=\s*(?:["'])?([^"'\r\n]+)/;
    }
    close $fh;
}
die "VERCEL_TOKEN not set (put it in .env as VERCEL_TOKEN=...)\n" unless $token;

my $name = shift // 'coeso-community';

my @files = qw(
    index.html
    stage-event.html
    archive.html
    assets/css/styles.css
    assets/js/main.js
    assets/js/archive.js
    assets/logo.svg
    assets/logo-mark.svg
);

my @payload_files;
for my $f (@files) {
    die "missing file: $f\n" unless -f $f;
    open my $fh, '<:raw', $f or die "$f: $!";
    local $/;
    my $data = <$fh>;
    close $fh;
    push @payload_files, {
        file     => $f,
        data     => encode_base64($data, ''),
        encoding => 'base64',
    };
}

my $body = encode_json({
    name            => $name,
    files           => \@payload_files,
    target           => 'production',
    projectSettings => {
        framework      => undef,
        buildCommand   => undef,
        outputDirectory => undef,
    },
});

my $payload_file = '.vercel-payload.json';
open my $out, '>:raw', $payload_file or die "$payload_file: $!";
print $out $body;
close $out;

print "Deploying " . scalar(@files) . " files as '$name'...\n";

my $json = `curl -sS -X POST "https://api.vercel.com/v13/deployments" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary \@$payload_file`;
my $res = eval { decode_json($json) } || {};

unlink $payload_file;

if ($res->{error}) {
    die "Vercel error: " . ($res->{error}{message} // 'unknown') . "\n";
}

my $url = $res->{url} // die "no url in response: $json\n";
my $id  = $res->{id} // '';
$url = "https://$url" unless $url =~ m{^https?://};

print "deployment id: $id\n";
print "deployment url: $url\n";

# Poll for readiness (max ~60s)
for (1 .. 30) {
    sleep 2;
    my $state = `curl -sS -H "Authorization: Bearer $token" "https://api.vercel.com/v13/deployments/$id"`;
    my $d = eval { decode_json($state) } || {};
    my $st = $d->{readyState} // 'UNKNOWN';
    print "state: $st\n";
    if ($st eq 'READY') {
        my @aliases = @{ $d->{alias} // [] };
        print "READY\n";
        print "alias: $_\n" for @aliases;
        exit 0;
    }
    if ($st eq 'ERROR' || $st eq 'CANCELED') {
        die "deployment failed: $st\n";
    }
}
print "timed out waiting for READY — check the deployment url above\n";
exit 1;
